import {
  entityIdSchema, engineEventSchema, gameCommandSchema, gameInputSchema, MAX_RUN_NUMBER, MIN_PLAYERS,
} from '../shared/game.js';
import type { EngineErrorCode, EngineEvent, GameState, Purchase, TransitionResult, UnclaimedOption } from '../shared/game.js';
import { auctionIdFor, eligiblePlayers, minimumBid, parseGameState, runIdFor } from './state.js';

/** The caller supplies a unique game ID and stable seats; no clocks or random IDs. */
export function createGame(input: unknown): GameState {
  const game = gameInputSchema.parse(input);
  return parseGameState({
    ...game, schemaVersion: 1, runNumber: 1, runId: runIdFor(game.gameId, 1), revision: 0,
    players: game.players.map((player) => ({ ...player, balance: game.settings.startingCurrency })),
    phase: 'lobby', paused: false, currentAuction: null, bids: [], purchases: [], unclaimed: [], completion: null,
  });
}

function finish(state: GameState, completion: NonNullable<GameState['completion']>, events: EngineEvent[]) {
  state.phase = 'finished';
  state.paused = false;
  state.completion = completion;
  events.push({ type: 'gameFinished', completion });
}

function unclaim(state: GameState, optionIndex: number, reason: UnclaimedOption['reason'], events: EngineEvent[]) {
  const revealed = state.currentAuction?.optionIndex === optionIndex;
  const option: UnclaimedOption = {
    optionId: state.optionIds[optionIndex]!,
    auctionId: revealed ? state.currentAuction!.id : null,
    status: reason === 'hostEnded' && !revealed ? 'unplayed' : 'unclaimed', reason,
  };
  state.unclaimed.push(option);
  events.push({ type: 'optionUnclaimed', option });
}

function purchase(state: GameState, playerId: string, price: number, reason: Purchase['reason'], events: EngineEvent[]) {
  const auction = state.currentAuction!;
  const player = state.players.find((seat) => seat.id === playerId)!;
  // Defence against programming errors: ordinary settlement is never public.
  if (state.purchases.some((entry) => entry.optionId === auction.optionId) || state.unclaimed.some((entry) => entry.optionId === auction.optionId)
    || price < state.settings.minimumOpeningBid || price > player.balance) throw new Error('Invalid settlement.');
  const entry: Purchase = { gameId: state.gameId, runId: state.runId, auctionId: auction.id, optionId: auction.optionId, playerId, price, reason };
  player.balance -= price;
  state.purchases.push(entry);
  state.phase = 'reveal';
  events.push({ type: 'optionPurchased', purchase: entry });
}

function settleIfForced(state: GameState, events: EngineEvent[]) {
  if (state.paused) throw new Error('Ordinary settlement is blocked while paused.');
  const auction = state.currentAuction!;
  if (auction.leader) {
    if (!eligiblePlayers(state, minimumBid(state)!).some((player) => player.id !== auction.leader!.playerId)) {
      purchase(state, auction.leader.playerId, auction.leader.amount, 'bid', events);
    }
  } else {
    const eligible = eligiblePlayers(state, state.settings.minimumOpeningBid);
    if (eligible.length === 1) {
      purchase(state, eligible[0]!.id, state.settings.minimumOpeningBid, 'lastEligible', events);
    } else if (eligible.length === 0) {
      unclaim(state, auction.optionIndex, 'noEligiblePlayers', events);
      // A funded player who conceded this option can return on the next one.
      if (state.players.some((player) => !player.sittingOut && player.balance >= state.settings.minimumOpeningBid)) state.phase = 'reveal';
      else {
        for (let index = auction.optionIndex + 1; index < state.optionIds.length; index++) unclaim(state, index, 'noEligiblePlayers', events);
        finish(state, { status: 'complete', reason: 'noEligiblePlayers' }, events);
      }
    }
  }
}

function openAuction(state: GameState, index: number, events: EngineEvent[]) {
  state.phase = 'bidding';
  state.currentAuction = {
    id: auctionIdFor(state.runId, index), optionId: state.optionIds[index]!, optionIndex: index,
    leader: null, concededPlayerIds: [],
  };
  events.push({ type: 'auctionOpened', auctionId: state.currentAuction.id, optionId: state.currentAuction.optionId, optionIndex: index });
  settleIfForced(state, events);
}

/** Pure reducer. Actor identity must come from the future server session, not a client claim. */
export function transition(original: GameState, actorPlayerId: unknown, input: unknown): TransitionResult {
  const reject = (code: EngineErrorCode, message: string, extra: { minimumBid?: number } = {}): TransitionResult => ({
    ok: false, state: original, events: [], error: { code, message, ...extra },
  });
  let state: GameState;
  try { state = parseGameState(original); } catch { return reject('INVALID_STATE', 'The game snapshot is invalid.'); }
  const parsed = gameCommandSchema.safeParse(input);
  if (!parsed.success) return reject('INVALID_COMMAND', 'The command has invalid fields.');
  const command = parsed.data;
  const actor = entityIdSchema.safeParse(actorPlayerId);
  if (!actor.success || !state.players.some((player) => player.id === actor.data)) return reject('INVALID_ACTOR', 'An existing player seat is required.');
  if (command.gameId !== state.gameId) return reject('STALE_GAME', 'This command belongs to another game.');
  if (command.runId !== state.runId) return reject('STALE_RUN', 'This command belongs to another run.');
  if (command.auctionId !== (state.currentAuction?.id ?? null)) return reject('STALE_AUCTION', 'This command belongs to another option.');
  if (command.phase !== state.phase) return reject('STALE_PHASE', 'The game phase has changed.');
  if (command.type !== 'bid' && command.type !== 'giveUp' && actor.data !== state.hostPlayerId) return reject('HOST_REQUIRED', 'Only the host player can use this control.');
  if (state.phase === 'finished' && command.type !== 'playAgain') return reject('GAME_FINISHED', 'This run has finished.');
  if (state.paused && !['resume', 'end', 'pause', 'sitOut'].includes(command.type)) return reject('PAUSED', 'The host must resume the game first.');
  if (['bid', 'giveUp'].includes(command.type) && state.players.find((player) => player.id === actor.data)!.sittingOut) return reject('SITTING_OUT', 'The host marked this seat Sit Out for this run.');
  if (state.revision === Number.MAX_SAFE_INTEGER) return reject('REVISION_LIMIT', 'The game revision limit has been reached.');
  const events: EngineEvent[] = [];

  switch (command.type) {
    case 'start':
      if (state.phase !== 'lobby') return reject('WRONG_PHASE', 'Start is only available in the lobby.');
      if (state.players.length < MIN_PLAYERS) return reject('PLAYER_COUNT', 'At least two players, including the host, are required.');
      events.push({ type: 'gameStarted', runId: state.runId });
      openAuction(state, 0, events);
      break;
    case 'bid': {
      if (state.phase !== 'bidding') return reject('WRONG_PHASE', 'Bidding is not open.');
      const auction = state.currentAuction!;
      if (auction.leader?.playerId === actor.data) return reject('LEADER_COMMITTED', 'The leader cannot raise their own bid.');
      if (auction.concededPlayerIds.includes(actor.data)) return reject('ALREADY_CONCEDED', 'You gave up this option.');
      const minimum = minimumBid(state)!;
      if (command.amount < minimum) return reject('BID_TOO_LOW', 'The bid must meet the current minimum.', { minimumBid: minimum });
      if (command.amount > state.players.find((player) => player.id === actor.data)!.balance) return reject('INSUFFICIENT_FUNDS', 'The bid exceeds your balance.');
      const bid = { commandId: command.commandId, auctionId: auction.id, optionId: auction.optionId, playerId: actor.data, amount: command.amount };
      state.bids.push(bid);
      auction.leader = { playerId: actor.data, amount: command.amount };
      events.push({ type: 'bidAccepted', bid });
      settleIfForced(state, events);
      break;
    }
    case 'giveUp': {
      if (state.phase !== 'bidding') return reject('WRONG_PHASE', 'Give Up is only available while bidding.');
      const auction = state.currentAuction!;
      if (auction.leader?.playerId === actor.data) return reject('LEADER_COMMITTED', 'The leading bid is binding.');
      if (auction.concededPlayerIds.includes(actor.data)) return reject('ALREADY_CONCEDED', 'You already gave up this option.');
      auction.concededPlayerIds.push(actor.data);
      events.push({ type: 'playerConceded', auctionId: auction.id, playerId: actor.data });
      settleIfForced(state, events);
      break;
    }
    case 'skip':
      if (state.phase !== 'bidding') return reject('WRONG_PHASE', 'Only an open, unbid option can be skipped.');
      if (state.currentAuction!.leader) return reject('BID_EXISTS', 'A binding leading bid cannot be skipped.');
      unclaim(state, state.currentAuction!.optionIndex, 'hostSkipped', events);
      state.phase = 'reveal';
      break;
    case 'next': {
      if (state.phase !== 'reveal') return reject('WRONG_PHASE', 'Next is only available after a result.');
      const nextIndex = state.currentAuction!.optionIndex + 1;
      if (nextIndex === state.optionIds.length) finish(state, { status: 'complete', reason: 'allOptionsResolved' }, events);
      else openAuction(state, nextIndex, events);
      break;
    }
    case 'pause':
      if (!['bidding', 'reveal'].includes(state.phase)) return reject('WRONG_PHASE', 'Only an active game can be paused.');
      if (state.paused) return reject('ALREADY_PAUSED', 'The game is already paused.');
      state.paused = true;
      events.push({ type: 'gamePaused', playerId: actor.data });
      break;
    case 'resume':
      if (!state.paused) return reject('NOT_PAUSED', 'The game is not paused.');
      state.paused = false;
      events.push({ type: 'gameResumed', playerId: actor.data });
      if (state.phase === 'bidding') settleIfForced(state, events);
      break;
    case 'sitOut': {
      if (!state.paused) return reject('WRONG_PHASE', 'Pause the active game before marking a departed player Sit Out.');
      const player = state.players.find((entry) => entry.id === command.playerId);
      if (!player || player.id === state.hostPlayerId || player.sittingOut) return reject('INVALID_SIT_OUT', 'Choose a departed non-host player who is still participating.');
      player.sittingOut = true;
      events.push({ type: 'playerSatOut', playerId: player.id });
      break;
    }
    case 'end': {
      // The sole settlement exception while paused: honour the binding bid before terminal cleanup.
      if (state.phase === 'bidding' && state.currentAuction!.leader) {
        const leader = state.currentAuction!.leader;
        purchase(state, leader.playerId, leader.amount, 'bid', events);
      }
      const resolved = new Set([...state.purchases, ...state.unclaimed].map((entry) => entry.optionId));
      for (const [index, optionId] of state.optionIds.entries()) {
        if (!resolved.has(optionId)) unclaim(state, index, 'hostEnded', events);
      }
      finish(state, { status: 'incomplete', reason: 'hostEnded' }, events);
      break;
    }
    case 'playAgain': {
      if (state.phase !== 'finished') return reject('WRONG_PHASE', 'Finish this run before playing again.');
      if (state.runNumber === MAX_RUN_NUMBER) return reject('RUN_LIMIT', 'Create a new game after the run limit.');
      const previousRunId = state.runId;
      state.runNumber += 1;
      state.runId = runIdFor(state.gameId, state.runNumber);
      state.phase = 'lobby';
      state.paused = false;
      state.currentAuction = null;
      state.completion = null;
      state.players = state.players.map((player) => ({ ...player, balance: state.settings.startingCurrency, sittingOut: false }));
      state.bids = [];
      state.purchases = [];
      state.unclaimed = [];
      events.push({ type: 'gameReset', previousRunId, runId: state.runId });
      break;
    }
  }
  state.revision += 1;
  // Validate postconditions outside the rejection path: an engine bug must fail loudly.
  return { ok: true, state: parseGameState(state), events: events.map((event) => engineEventSchema.parse(event)) };
}
