import { describe, expect, it } from 'vitest';
import { createGame, defaultAuctionSettings, minimumBid, parseGameState, transition } from '../engine/index.js';
import { gameCommandSchema, gameInputSchema, MAX_OPTIONS } from '../shared/game.js';
import type { EngineErrorCode, GameCommand, GameInput, GameState, TransitionResult } from '../shared/game.js';

// Development fixtures only. All balances below are obtained by actual transitions.
const ids = ['host-seat', 'river-seat', 'sky-seat', 'ash-seat', 'fern-seat'];
function input(count = 2, optionCount = 4, settings: Partial<GameInput['settings']> = {}): GameInput {
  return {
    gameId: 'test-game', hostPlayerId: ids[0]!,
    settings: { ...defaultAuctionSettings(), ...settings },
    optionIds: Array.from({ length: optionCount }, (_, index) => `option-${index + 1}`),
    players: Array.from({ length: count }, (_, index) => ({ id: ids[index] ?? `extra-${index}`, name: `Player ${index + 1}` })),
  };
}
function command(state: GameState, type: GameCommand['type'], fields: Record<string, unknown> = {}) {
  return {
    commandId: `command-${state.revision + 1}`, gameId: state.gameId, runId: state.runId,
    auctionId: state.currentAuction?.id ?? null, phase: state.phase, type, ...fields,
  };
}
function conservation(state: GameState) {
  for (const player of state.players) {
    const spent = state.purchases.filter((entry) => entry.playerId === player.id).reduce((sum, entry) => sum + entry.price, 0);
    expect(player.balance).toBeGreaterThanOrEqual(0);
    expect(Number.isSafeInteger(player.balance)).toBe(true);
    expect(player.balance + spent).toBe(state.settings.startingCurrency);
  }
  expect(new Set(state.purchases.map((entry) => entry.auctionId)).size).toBe(state.purchases.length);
  const resolved = [...state.purchases, ...state.unclaimed].map((entry) => entry.optionId);
  expect(new Set(resolved).size).toBe(resolved.length);
  for (const purchase of state.purchases) expect(purchase.price).toBeGreaterThanOrEqual(state.settings.minimumOpeningBid);
  if (state.phase === 'finished') expect(new Set(resolved)).toEqual(new Set(state.optionIds));
}
function accepted(state: GameState, actor: string, type: GameCommand['type'], fields: Record<string, unknown> = {}) {
  const original = JSON.stringify(state);
  const result = transition(state, actor, command(state, type, fields));
  if (!result.ok) throw new Error(`Unexpected rejection of ${type}: ${result.error.code}: ${result.error.message}`);
  expect(JSON.stringify(state)).toBe(original);
  expect(result.state.revision).toBe(state.revision + 1);
  conservation(result.state);
  const charged = state.players.reduce((sum, player) => sum + player.balance, 0)
    - result.state.players.reduce((sum, player) => sum + player.balance, 0);
  if (type !== 'playAgain') {
    const eventCosts = result.events.reduce((sum, event) => sum + (event.type === 'optionPurchased' ? event.purchase.price : 0), 0);
    expect(charged).toBe(eventCosts);
  }
  return result;
}
function step(state: GameState, type: GameCommand['type'], actor = ids[0]!, fields: Record<string, unknown> = {}) {
  return accepted(state, actor, type, fields).state;
}
function rejected(state: GameState, actor: unknown, payload: unknown, code: EngineErrorCode) {
  const original = JSON.stringify(state);
  const result = transition(state, actor, payload);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected command rejection');
  expect(result.error.code).toBe(code);
  expect(result.state).toBe(state);
  expect(result.events).toEqual([]);
  expect(JSON.stringify(state)).toBe(original);
  return result;
}
const start = (count = 2, optionCount = 4, settings: Partial<GameInput['settings']> = {}) => step(createGame(input(count, optionCount, settings)), 'start');

describe('explicit Sit Out preserves economics', () => {
  it('requires host confirmation and a paused game, never allows the host to sit out', () => {
    const state = start(3);
    rejected(state, ids[0], command(state, 'sitOut', { playerId: ids[1], confirmed: true }), 'WRONG_PHASE');
    const paused = step(state, 'pause');
    rejected(paused, ids[1], command(paused, 'sitOut', { playerId: ids[2], confirmed: true }), 'HOST_REQUIRED');
    rejected(paused, ids[0], command(paused, 'sitOut', { playerId: ids[1] }), 'INVALID_COMMAND');
    rejected(paused, ids[0], command(paused, 'sitOut', { playerId: ids[0], confirmed: true }), 'INVALID_SIT_OUT');
  });
  it('retains the departed leader commitment and owned items, and resets participation on Play Again', () => {
    let state = start();
    state = step(state, 'bid', ids[1], { amount: 3 });
    state = step(state, 'giveUp');
    state = step(state, 'next');
    state = step(state, 'bid', ids[1], { amount: 4 });
    state = step(state, 'pause');
    state = step(state, 'sitOut', ids[0], { playerId: ids[1], confirmed: true });
    expect(state.purchases).toHaveLength(1); expect(state.players[1]!.balance).toBe(17);
    state = step(state, 'resume');
    rejected(state, ids[1], command(state, 'bid', { amount: 5 }), 'SITTING_OUT');
    state = step(state, 'giveUp');
    expect(state.purchases.map((entry) => entry.price)).toEqual([3, 4]); expect(state.players[1]!.balance).toBe(13);
    state = step(state, 'next');
    expect(state.purchases[2]!.playerId).toBe(ids[0]); expect(state.purchases[2]!.price).toBe(1);
    state = step(state, 'end', ids[0], { confirmed: true }); state = step(state, 'playAgain');
    expect(state.players.every((player) => !player.sittingOut && player.balance === 20)).toBe(true);
  });
  it('does not settle forced results while paused; Resume pays the existing price once', () => {
    let state = step(start(), 'bid', ids[0], { amount: 7 }); state = step(state, 'pause');
    state = step(state, 'sitOut', ids[0], { playerId: ids[1], confirmed: true });
    expect(state.purchases).toHaveLength(0); expect(state.players[0]!.balance).toBe(20);
    rejected(state, ids[0], command(state, 'next'), 'PAUSED');
    state = step(state, 'resume'); expect(state.purchases[0]!.price).toBe(7); expect(state.players[0]!.balance).toBe(13);
  });
  it('unclaims only the current option when funded conceders can return next option', () => {
    let state = step(start(3), 'giveUp'); state = step(state, 'pause');
    for (const playerId of [ids[1], ids[2]]) state = step(state, 'sitOut', ids[0], { playerId, confirmed: true });
    state = step(state, 'resume'); expect(state.phase).toBe('reveal'); expect(state.unclaimed).toHaveLength(1);
    state = step(state, 'next'); expect(state.purchases).toHaveLength(1); expect(state.purchases[0]!.playerId).toBe(ids[0]); expect(state.players[0]!.balance).toBe(19);
  });
  it('ends without free items when only broke or sitting-out seats remain', () => {
    let state = step(start(3), 'bid', ids[0], { amount: 20 });
    state = step(state, 'next'); state = step(state, 'pause');
    for (const playerId of [ids[1], ids[2]]) state = step(state, 'sitOut', ids[0], { playerId, confirmed: true });
    state = step(state, 'resume'); expect(state.completion?.reason).toBe('noEligiblePlayers'); expect(state.purchases).toHaveLength(1); expect(state.unclaimed).toHaveLength(3);
  });
});
const bid = (state: GameState, actor: string, amount: number) => step(state, 'bid', actor, { amount });
const balances = (state: GameState) => state.players.map((player) => player.balance);

describe('engine creation and command boundaries', () => {
  it.each([2, 3, 4, 5])('starts %i equal seats including a host identified independently of position', (count) => {
    const config = input(count);
    config.hostPlayerId = ids[count - 1]!;
    const lobby = createGame(config);
    const result = accepted(lobby, config.hostPlayerId, 'start');
    expect(result.state.phase).toBe('bidding');
    expect(balances(result.state)).toEqual(Array(count).fill(20));
    expect(result.state.players).toHaveLength(count);
    expect(result.events.map((event) => event.type)).toEqual(['gameStarted', 'auctionOpened']);
    expect(result.state.currentAuction).toMatchObject({ optionIndex: 0, optionId: 'option-1', leader: null, concededPlayerIds: [] });
  });
  it('permits a one-seat lobby but rejects Start with one or six players', () => {
    const one = createGame(input(1));
    rejected(one, ids[0], command(one, 'start'), 'PLAYER_COUNT');
    expect(() => createGame(input(6))).toThrow();
    const six = createGame(input(5));
    six.players.push({ id: 'sixth', name: 'Sixth', balance: 20, sittingOut: false });
    rejected(six, ids[0], command(six, 'start'), 'INVALID_STATE');
  });
  it.each([
    { hostPlayerId: 'missing' },
    { players: [{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }] },
    { players: [] }, { optionIds: [] }, { optionIds: ['same', 'same'] },
    { optionIds: Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `item-${i}`) },
    { players: [{ id: 'host-seat', name: 'x'.repeat(41) }] },
    { gameId: 'x'.repeat(65) }, { gameId: '../outside' }, { spectator: true },
  ])('rejects invalid creation input %j', (changes) => {
    expect(gameInputSchema.safeParse({ ...input(), ...changes }).success).toBe(false);
  });
  it('copies creation input and never uses names as seat identities', () => {
    const config = input();
    config.players.forEach((player) => { player.name = 'Same name'; });
    const state = createGame(config);
    config.optionIds[0] = 'changed';
    config.players[0]!.name = 'Changed';
    config.settings.startingCurrency = 999;
    expect(state.optionIds[0]).toBe('option-1');
    expect(state.players.map((player) => player.name)).toEqual(['Same name', 'Same name']);
    expect(state.settings.startingCurrency).toBe(20);
    rejected(state, 'Same name', command(state, 'start'), 'INVALID_ACTOR');
  });
  it.each([-1, 0, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1_000_001, '2'])('rejects invalid bid amount %s', (amount) => {
    const state = start();
    rejected(state, ids[0], command(state, 'bid', { amount }), 'INVALID_COMMAND');
  });
  it.each([
    ['gameId', 'another-game', 'STALE_GAME'], ['runId', 'old-run', 'STALE_RUN'],
    ['auctionId', 'old-auction', 'STALE_AUCTION'], ['phase', 'lobby', 'STALE_PHASE'],
  ] as const)('rejects stale %s', (field, value, code) => {
    const state = start();
    rejected(state, ids[1], command(state, 'bid', { amount: 1, [field]: value }), code);
  });
  it('rejects unknown actors, extra fields, missing context and unbounded input', () => {
    const state = start();
    for (const actor of ['unseated-admin', '', null, 3, { id: ids[0] }]) rejected(state, actor, command(state, 'bid', { amount: 1 }), 'INVALID_ACTOR');
    for (const payload of [null, {}, { type: 'bid', amount: 1 }, command(state, 'bid', { amount: 1, balance: 999 }), command(state, 'bid', { amount: 1, commandId: 'x'.repeat(65) })]) {
      rejected(state, ids[0], payload, 'INVALID_COMMAND');
    }
    expect(gameCommandSchema.safeParse(command(state, 'end', { confirmed: false })).success).toBe(false);
    expect(gameCommandSchema.safeParse(command(state, 'end')).success).toBe(false);
  });
  it.each(['start', 'skip', 'next', 'pause', 'resume', 'end', 'playAgain'] as const)('reserves %s for the host seat', (type) => {
    const state = start();
    rejected(state, ids[1], command(state, type, type === 'end' ? { confirmed: true } : {}), 'HOST_REQUIRED');
  });
  it('rejects malformed saved balances and duplicate settlement records', () => {
    const bad = start();
    bad.players[0]!.balance = 19;
    rejected(bad, ids[0], command(bad, 'bid', { amount: 1 }), 'INVALID_STATE');
    const paid = bid(start(), ids[0]!, 20);
    paid.purchases.push({ ...paid.purchases[0]! });
    expect(() => parseGameState(paid)).toThrow();
    rejected(paid, ids[0], command(paid, 'next'), 'INVALID_STATE');
  });
  it('rejects corrupted terminal reasons and concealed revealed options', () => {
    const ended = step(start(), 'end', ids[0], { confirmed: true });
    const forgedFinish = structuredClone(ended);
    forgedFinish.completion = { status: 'complete', reason: 'noEligiblePlayers' };
    expect(() => parseGameState(forgedFinish)).toThrow();
    const forgedOption = structuredClone(ended);
    forgedOption.unclaimed[0]!.auctionId = null;
    forgedOption.unclaimed[0]!.status = 'unplayed';
    expect(() => parseGameState(forgedOption)).toThrow();
  });
  it.each([
    ['start', 'bidding'], ['bid', 'lobby'], ['bid', 'reveal'],
    ['giveUp', 'lobby'], ['giveUp', 'reveal'], ['skip', 'lobby'], ['skip', 'reveal'],
    ['next', 'lobby'], ['next', 'bidding'], ['pause', 'lobby'], ['playAgain', 'lobby'], ['playAgain', 'reveal'],
  ] as const)('rejects %s in %s even with fresh context', (type, phase) => {
    const state = phase === 'lobby' ? createGame(input()) : phase === 'bidding' ? start() : step(start(), 'skip');
    rejected(state, ids[0], command(state, type, type === 'bid' ? { amount: 1 } : {}), 'WRONG_PHASE');
  });
});

describe('auction prices, commitments and concessions', () => {
  it('separates opening price and increment, and allows a jump that is not an increment multiple', () => {
    let state = start(2, 4, { minimumOpeningBid: 2, minimumBidIncrease: 3 });
    expect(minimumBid(state)).toBe(2);
    expect(rejected(state, ids[0], command(state, 'bid', { amount: 1 }), 'BID_TOO_LOW').error.minimumBid).toBe(2);
    state = bid(state, ids[0]!, 2);
    expect(minimumBid(state)).toBe(5);
    rejected(state, ids[1], command(state, 'bid', { amount: 4 }), 'BID_TOO_LOW');
    state = bid(state, ids[1]!, 7);
    expect(state.currentAuction!.leader).toEqual({ playerId: ids[1], amount: 7 });
    expect(minimumBid(state)).toBe(10);
    expect(balances(state)).toEqual([20, 20]);
  });
  it('accepts the first of equal bids in server order and rejects the other', () => {
    const initial = start();
    const concurrent = command(initial, 'bid', { amount: 4 });
    const first = transition(initial, ids[0], concurrent);
    expect(first.ok).toBe(true);
    rejected(first.state, ids[1], concurrent, 'BID_TOO_LOW');
    expect(first.state.bids).toHaveLength(1);
  });
  it('accepts an exact minimum raise and rejects a late bid after the next option opens', () => {
    let state = bid(start(), ids[0]!, 1);
    const delayed = command(state, 'bid', { amount: 2 });
    state = bid(state, ids[1]!, 2);
    expect(state.currentAuction!.leader!.amount).toBe(2);
    state = step(step(state, 'giveUp'), 'next');
    rejected(state, ids[1], delayed, 'STALE_AUCTION');
    expect(state.currentAuction!.leader).toBeNull();
    expect(state.purchases).toHaveLength(1);
  });
  it('never charges or reserves a losing bid, and settles the winner once', () => {
    let state = bid(start(), ids[0]!, 5);
    state = bid(state, ids[1]!, 7);
    expect(balances(state)).toEqual([20, 20]);
    expect(state.purchases).toEqual([]);
    const originalCommand = command(state, 'giveUp');
    const result = accepted(state, ids[0]!, 'giveUp');
    state = result.state;
    expect(state.phase).toBe('reveal');
    expect(balances(state)).toEqual([20, 13]);
    expect(state.purchases).toHaveLength(1);
    expect(state.purchases[0]).toMatchObject({ playerId: ids[1], price: 7, reason: 'bid' });
    expect(result.events.map((event) => event.type)).toEqual(['playerConceded', 'optionPurchased']);
    rejected(state, ids[0], originalCommand, 'STALE_PHASE');
    rejected(state, ids[0], command(state, 'giveUp'), 'WRONG_PHASE');
  });
  it('settles at the accepted price when nobody can afford the next raise', () => {
    const state = bid(start(3, 3, { minimumBidIncrease: 5 }), ids[1]!, 16);
    expect(state.phase).toBe('reveal');
    expect(balances(state)).toEqual([20, 4, 20]);
    expect(state.purchases[0]!.price).toBe(16);
  });
  it('handles a next minimum above the currency cap without overflowing or overcharging', () => {
    const state = bid(start(2, 1, { startingCurrency: 1_000_000, minimumBidIncrease: 1_000_000 }), ids[0]!, 1);
    expect(balances(state)).toEqual([999_999, 1_000_000]);
    conservation(state);
  });
  it('treats Bet All as a normal exact-balance bid and rejects over-budget bids', () => {
    const initial = start();
    rejected(initial, ids[0], command(initial, 'bid', { amount: 21 }), 'INSUFFICIENT_FUNDS');
    const result = accepted(initial, ids[0]!, 'bid', { amount: initial.players[0]!.balance });
    expect(result.events.map((event) => event.type)).toEqual(['bidAccepted', 'optionPurchased']);
    expect(balances(result.state)).toEqual([0, 20]);
    expect(result.state.purchases[0]!.price).toBe(20);
    rejected(result.state, ids[1], command(initial, 'bid', { amount: 20 }), 'STALE_PHASE');
  });
  it('forbids self-raises, leader withdrawal and skipping a binding bid', () => {
    const state = bid(start(), ids[0]!, 4);
    rejected(state, ids[0], command(state, 'bid', { amount: 5 }), 'LEADER_COMMITTED');
    rejected(state, ids[0], command(state, 'bid', { amount: 20 }), 'LEADER_COMMITTED');
    rejected(state, ids[0], command(state, 'giveUp'), 'LEADER_COMMITTED');
    rejected(state, ids[0], command(state, 'skip'), 'BID_EXISTS');
    rejected(state, ids[0], { ...command(state, 'giveUp'), type: 'withdraw' }, 'INVALID_COMMAND');
  });
  it('makes concessions irreversible for this option and resets them for the next', () => {
    let state = step(start(3), 'giveUp', ids[2]);
    rejected(state, ids[2], command(state, 'bid', { amount: 1 }), 'ALREADY_CONCEDED');
    rejected(state, ids[2], command(state, 'giveUp'), 'ALREADY_CONCEDED');
    state = bid(state, ids[0]!, 2);
    state = bid(state, ids[1]!, 3);
    state = step(state, 'giveUp');
    state = step(state, 'next');
    expect(state.currentAuction!.concededPlayerIds).toEqual([]);
    state = bid(state, ids[2]!, 1);
    expect(state.currentAuction!.leader!.playerId).toBe(ids[2]);
  });
  it('forces the final eligible player to pay before a queued second concession', () => {
    const initial = start(2, 3, { minimumOpeningBid: 2 });
    const queuedConcession = command(initial, 'giveUp');
    const state = step(initial, 'giveUp');
    expect(state.phase).toBe('reveal');
    expect(state.currentAuction!.leader).toBeNull();
    expect(state.bids).toEqual([]);
    expect(balances(state)).toEqual([20, 18]);
    expect(state.purchases[0]).toMatchObject({ playerId: ids[1], price: 2, reason: 'lastEligible' });
    rejected(state, ids[1], queuedConcession, 'STALE_PHASE');
    expect(state.unclaimed).toEqual([]);
  });
  it('supports sequential concessions with three seats and no bid', () => {
    let state = step(start(3), 'giveUp', ids[1]);
    expect(state.phase).toBe('bidding');
    state = step(state, 'giveUp', ids[2]);
    expect(state.purchases[0]).toMatchObject({ playerId: ids[0], price: 1, reason: 'lastEligible' });
  });
  it('does not count rich conceding opponents as competition', () => {
    let state = step(start(3), 'giveUp', ids[2]);
    state = bid(state, ids[1]!, 3);
    state = step(state, 'giveUp');
    expect(balances(state)).toEqual([20, 17, 20]);
    expect(state.phase).toBe('reveal');
  });
  it('skips only unbid options without a charge and rejects a duplicated Next after advancement', () => {
    let state = step(start(), 'skip');
    expect(state.unclaimed).toEqual([{ optionId: 'option-1', auctionId: state.currentAuction!.id, status: 'unclaimed', reason: 'hostSkipped' }]);
    expect(balances(state)).toEqual([20, 20]);
    const next = command(state, 'next');
    state = step(state, 'next');
    rejected(state, ids[0], next, 'STALE_AUCTION');
    expect(state.currentAuction!.optionIndex).toBe(1);
  });
});

describe('independent balances and paid automatic purchases', () => {
  it('keeps two funded opponents bidding when a third player is broke', () => {
    let state = bid(start(3), ids[0]!, 20);
    state = step(state, 'next');
    expect(balances(state)).toEqual([0, 20, 20]);
    expect(state.phase).toBe('bidding');
    rejected(state, ids[0], command(state, 'bid', { amount: 1 }), 'INSUFFICIENT_FUNDS');
    state = bid(state, ids[1]!, 1);
    state = bid(state, ids[2]!, 2);
    expect(state.phase).toBe('bidding');
    state = step(state, 'giveUp', ids[1]);
    expect(balances(state)).toEqual([0, 20, 18]);
  });
  it('$3 buys exactly three $1 automatic options; the final two remain unclaimed', () => {
    let state = bid(start(2, 6, { startingCurrency: 3 }), ids[0]!, 3);
    for (const remaining of [2, 1, 0]) {
      const result = accepted(state, ids[0]!, 'next');
      state = result.state;
      expect(state.phase).toBe('reveal');
      expect(balances(state)).toEqual([0, remaining]);
      expect(result.events.filter((event) => event.type === 'optionPurchased')).toHaveLength(1);
    }
    expect(state.purchases.filter((entry) => entry.playerId === ids[1]).map((entry) => entry.price)).toEqual([1, 1, 1]);
    state = step(state, 'next');
    expect(state.phase).toBe('finished');
    expect(state.completion).toEqual({ status: 'complete', reason: 'noEligiblePlayers' });
    expect(state.unclaimed.map((entry) => [entry.optionId, entry.reason, entry.status])).toEqual([
      ['option-5', 'noEligiblePlayers', 'unclaimed'], ['option-6', 'noEligiblePlayers', 'unclaimed'],
    ]);
    expect(state.unclaimed[1]!.auctionId).toBeNull();
    expect(state.purchases).toHaveLength(4);
    expect(balances(state)).toEqual([0, 0]);
  });
  it('stops automatic purchases when the remaining balance is below a non-unit opening price', () => {
    let state = bid(start(2, 5, { startingCurrency: 5, minimumOpeningBid: 2 }), ids[0]!, 5);
    state = step(state, 'next');
    expect(balances(state)).toEqual([0, 3]);
    state = step(state, 'next');
    expect(balances(state)).toEqual([0, 1]);
    state = step(state, 'next');
    expect(state.phase).toBe('finished');
    expect(state.unclaimed).toHaveLength(2);
    expect(state.purchases.map((entry) => entry.price)).toEqual([5, 2, 2]);
  });
  it('finishes normally after the last result without inventing a winner or score', () => {
    let state = step(start(2, 1), 'giveUp');
    expect(state.phase).toBe('reveal');
    state = step(state, 'next');
    expect(state.completion).toEqual({ status: 'complete', reason: 'allOptionsResolved' });
    expect(state).not.toHaveProperty('winner');
    expect(state).not.toHaveProperty('score');
    expect(minimumBid(state)).toBeNull();
  });
});

describe('pause, terminal End and fresh runs', () => {
  it('preserves a binding bid while pausing and blocks ordinary actions', () => {
    let state = bid(start(), ids[1]!, 4);
    state = step(state, 'pause');
    expect(state.phase).toBe('bidding');
    expect(state.paused).toBe(true);
    expect(state.currentAuction!.leader).toEqual({ playerId: ids[1], amount: 4 });
    for (const type of ['bid', 'giveUp', 'skip', 'next', 'start', 'playAgain'] as const) {
      rejected(state, ids[0], command(state, type, type === 'bid' ? { amount: 5 } : {}), 'PAUSED');
    }
    rejected(state, ids[0], command(state, 'pause'), 'ALREADY_PAUSED');
    expect(balances(state)).toEqual([20, 20]);
    expect(state.purchases).toEqual([]);
    state = step(state, 'resume');
    expect(state.phase).toBe('bidding');
    expect(state.purchases).toEqual([]);
    rejected(state, ids[0], command(state, 'resume'), 'NOT_PAUSED');
    state = step(state, 'giveUp');
    expect(balances(state)).toEqual([20, 16]);
  });
  it('freezes reveal advancement and automatic purchasing until host Resume', () => {
    let state = bid(start(2, 3, { startingCurrency: 3 }), ids[0]!, 3);
    state = step(state, 'pause');
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    expect(parseGameState(saved)).toEqual(state);
    rejected(state, ids[0], command(state, 'next'), 'PAUSED');
    expect(balances(state)).toEqual([0, 3]);
    state = step(saved, 'resume');
    expect(state.phase).toBe('reveal');
    expect(state.purchases).toHaveLength(1);
    state = step(state, 'next');
    expect(state.purchases).toHaveLength(2);
    expect(balances(state)).toEqual([0, 2]);
  });
  it.each([false, true])('End settles a binding bid once, including while paused=%s', (paused) => {
    let state = bid(start(3), ids[0]!, 3);
    state = bid(state, ids[1]!, 7);
    if (paused) state = step(state, 'pause');
    const end = command(state, 'end', { confirmed: true });
    rejected(state, ids[0], command(state, 'end'), 'INVALID_COMMAND');
    rejected(state, ids[0], command(state, 'end', { confirmed: false }), 'INVALID_COMMAND');
    const result = accepted(state, ids[0]!, 'end', { confirmed: true });
    state = result.state;
    expect(state.phase).toBe('finished');
    expect(state.paused).toBe(false);
    expect(state.completion).toEqual({ status: 'incomplete', reason: 'hostEnded' });
    expect(balances(state)).toEqual([20, 13, 20]);
    expect(state.purchases).toHaveLength(1);
    expect(state.purchases[0]).toMatchObject({ price: 7, playerId: ids[1], reason: 'bid' });
    expect(state.unclaimed).toHaveLength(3);
    expect(state.unclaimed.every((entry) => entry.status === 'unplayed' && entry.auctionId === null)).toBe(true);
    expect(result.events[0]!.type).toBe('optionPurchased');
    expect(result.events.at(-1)!.type).toBe('gameFinished');
    rejected(state, ids[0], end, 'STALE_PHASE');
    rejected(state, ids[0], command(state, 'end', { confirmed: true }), 'GAME_FINISHED');
  });
  it('End without a bid leaves the current option unclaimed and later options unplayed', () => {
    const state = step(start(), 'end', ids[0], { confirmed: true });
    expect(balances(state)).toEqual([20, 20]);
    expect(state.unclaimed[0]).toMatchObject({ optionId: 'option-1', status: 'unclaimed', reason: 'hostEnded' });
    expect(state.unclaimed.slice(1).every((entry) => entry.status === 'unplayed')).toBe(true);
  });
  it.each([false, true])('End during a reveal never charges a settled purchase again (paused=%s)', (paused) => {
    let state = step(start(), 'giveUp');
    if (paused) state = step(state, 'pause');
    const result = accepted(state, ids[0]!, 'end', { confirmed: true });
    expect(balances(result.state)).toEqual([20, 19]);
    expect(result.state.purchases).toHaveLength(1);
    expect(result.events.some((event) => event.type === 'optionPurchased')).toBe(false);
  });
  it('can cancel a lobby with confirmed End; all options are unplayed', () => {
    const state = step(createGame(input(1)), 'end', ids[0], { confirmed: true });
    expect(state.currentAuction).toBeNull();
    expect(state.unclaimed.every((entry) => entry.status === 'unplayed')).toBe(true);
    expect(state.completion!.status).toBe('incomplete');
  });
  it.each(['start', 'bid', 'giveUp', 'skip', 'next', 'pause', 'resume', 'end'] as const)('rejects %s against a finished run', (type) => {
    const state = step(start(), 'end', ids[0], { confirmed: true });
    const fields = type === 'bid' ? { amount: 1 } : type === 'end' ? { confirmed: true } : {};
    rejected(state, ids[0], command(state, type, fields), 'GAME_FINISHED');
  });
  it('Play Again resets budgets and collections into a fresh lobby and never reuses an auction ID', () => {
    let state = bid(start(3), ids[0]!, 20);
    const firstAuction = state.currentAuction!.id;
    const oldRunCommand = command(state, 'next');
    state = step(state, 'next');
    state = step(state, 'giveUp', ids[2]);
    state = step(state, 'end', ids[0], { confirmed: true });
    expect(state.purchases.length).toBeGreaterThan(0);
    expect(state.unclaimed.length).toBeGreaterThan(0);
    const seats = state.players.map(({ id, name }) => ({ id, name }));
    state = step(state, 'playAgain');
    expect(state.phase).toBe('lobby');
    expect(state.hostPlayerId).toBe(ids[0]);
    expect(state.players.map(({ id, name }) => ({ id, name }))).toEqual(seats);
    expect(balances(state)).toEqual([20, 20, 20]);
    expect(state.currentAuction).toBeNull();
    expect(state.bids).toEqual([]);
    expect(state.purchases).toEqual([]);
    expect(state.unclaimed).toEqual([]);
    expect(state.completion).toBeNull();
    expect(state.runNumber).toBe(2);
    rejected(state, ids[0], oldRunCommand, 'STALE_RUN');
    state = step(state, 'start');
    expect(state.currentAuction!.id).not.toBe(firstAuction);
    expect(state.currentAuction!.concededPlayerIds).toEqual([]);
    const secondRun = state.runId;
    state = step(step(state, 'end', ids[0], { confirmed: true }), 'playAgain');
    expect(state.runNumber).toBe(3);
    expect(state.runId).not.toBe(secondRun);
    rejected(state, ids[0], oldRunCommand, 'STALE_RUN');
  });
  it('allows Play Again after a naturally completed run but not while playing', () => {
    let state = start(2, 1);
    rejected(state, ids[0], command(state, 'playAgain'), 'WRONG_PHASE');
    state = step(step(state, 'skip'), 'next');
    state = step(state, 'playAgain');
    expect(state.phase).toBe('lobby');
    expect(state.runNumber).toBe(2);
  });
});

describe('determinism and independent snapshots', () => {
  function deepFreeze(value: unknown) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
  }
  it('runs against deeply frozen input and produces identical detached results', () => {
    const state = start();
    const payload = command(state, 'bid', { amount: 20 });
    deepFreeze(state);
    deepFreeze(payload);
    const a = transition(state, ids[0], payload);
    const b = transition(JSON.parse(JSON.stringify(state)) as GameState, ids[0], payload);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    if (!a.ok) throw new Error('Expected accepted bid');
    const purchaseEvent = a.events.find((event) => event.type === 'optionPurchased')!;
    purchaseEvent.purchase.price = 999;
    expect(a.state.purchases[0]!.price).toBe(20);
    a.state.players[0]!.name = 'Changed result';
    expect(state.players[0]!.name).toBe('Player 1');
  });
  it.each([2, 3, 4, 5])('conserves money across 20 generated full games with %i seats', (count) => {
    // Seeded test-only generator; engine execution itself uses no randomness.
    for (let seed = 1; seed <= 20; seed++) {
      let number = seed;
      const draw = (max: number) => { number = (number * 1664525 + 1013904223) >>> 0; return number % max; };
      const budget = 1 + draw(12);
      let state = start(count, 1 + draw(8), { startingCurrency: budget, minimumOpeningBid: 1 + draw(budget), minimumBidIncrease: 1 + draw(4) });
      let steps = 0;
      const trace: { actor: string; payload: ReturnType<typeof command> }[] = [];
      const replayStart = state;
      while (state.phase !== 'finished') {
        expect(++steps).toBeLessThan(500);
        let actor = ids[0]!;
        let payload: ReturnType<typeof command>;
        if (state.phase === 'reveal') payload = command(state, 'next');
        else {
          const auction = state.currentAuction!;
          const candidates = state.players.filter((player) => player.id !== auction.leader?.playerId && !auction.concededPlayerIds.includes(player.id));
          const selected = candidates[draw(candidates.length)]!;
          actor = selected.id;
          const minimum = auction.leader ? auction.leader.amount + state.settings.minimumBidIncrease : state.settings.minimumOpeningBid;
          payload = selected.balance < minimum || draw(3) === 0
            ? command(state, 'giveUp')
            : command(state, 'bid', { amount: minimum + draw(selected.balance - minimum + 1) });
        }
        trace.push({ actor, payload });
        const result: TransitionResult = transition(state, actor, payload);
        if (!result.ok) throw new Error(`Generated legal command failed: ${result.error.code}`);
        state = result.state;
        conservation(state);
      }
      let replay = replayStart;
      for (const entry of trace) {
        const result = transition(replay, entry.actor, entry.payload);
        expect(result.ok).toBe(true);
        replay = result.state;
      }
      expect(replay).toEqual(state);
      expect(state.completion!.status).toBe('complete');
    }
  });
});
