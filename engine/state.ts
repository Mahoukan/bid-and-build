import { gameStateSchema, MIN_PLAYERS } from '../shared/game.js';
import type { GameState } from '../shared/game.js';

export const runIdFor = (gameId: string, runNumber: number) => `${gameId}:run:${runNumber}`;
export const auctionIdFor = (runId: string, optionIndex: number) => `${runId}:auction:${optionIndex + 1}`;

export function minimumBid(state: GameState): number | null {
  if (state.phase !== 'bidding' || !state.currentAuction) return null;
  return state.currentAuction.leader
    ? state.currentAuction.leader.amount + state.settings.minimumBidIncrease
    : state.settings.minimumOpeningBid;
}

export function eligiblePlayers(state: GameState, price: number) {
  const conceded = state.currentAuction?.concededPlayerIds ?? [];
  return state.players.filter((player) => !player.sittingOut && player.balance >= price && !conceded.includes(player.id));
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid engine state: ${message}`);
}

/** Validate a private snapshot (including JSON rehydration) and return a detached copy. */
export function parseGameState(input: unknown): GameState {
  const state = gameStateSchema.parse(input);
  const { players, settings, currentAuction: auction, optionIds, purchases, unclaimed, bids } = state;
  const playerIds = new Set(players.map((player) => player.id));
  invariant(playerIds.size === players.length, 'duplicate player ID');
  invariant(playerIds.has(state.hostPlayerId), 'host has no seat');
  invariant(state.runId === runIdFor(state.gameId, state.runNumber), 'run identity');
  invariant(!state.paused || ['bidding', 'reveal'].includes(state.phase), 'paused terminal/lobby phase');
  invariant((state.phase === 'finished') === (state.completion !== null), 'completion phase');
  if (state.completion) {
    invariant((state.completion.status === 'incomplete') === (state.completion.reason === 'hostEnded'), 'completion reason');
    if (state.completion.reason === 'allOptionsResolved') {
      invariant(auction?.optionIndex === optionIds.length - 1, 'normal finish before the last option');
    }
    if (state.completion.reason === 'noEligiblePlayers') {
      invariant(auction && players.every((player) => player.sittingOut || player.balance < settings.minimumOpeningBid), 'early finish with affordable options');
    }
  }
  if (state.phase === 'lobby') {
    invariant(!auction && !bids.length && !purchases.length && !unclaimed.length, 'lobby has auction history');
  } else if (state.phase !== 'finished') {
    invariant(auction && players.length >= MIN_PLAYERS, 'active game needs an auction and at least two seats');
  }
  if (auction) {
    invariant(players.length >= MIN_PLAYERS, 'revealed game has fewer than two seats');
    invariant(optionIds[auction.optionIndex] === auction.optionId, 'current option identity');
    invariant(auction.id === auctionIdFor(state.runId, auction.optionIndex), 'auction identity');
    invariant(new Set(auction.concededPlayerIds).size === auction.concededPlayerIds.length, 'duplicate concession');
    invariant(auction.concededPlayerIds.every((id) => playerIds.has(id)), 'unknown conceding player');
    invariant(!auction.leader || (playerIds.has(auction.leader.playerId) && !auction.concededPlayerIds.includes(auction.leader.playerId)), 'leader cannot concede');
  }

  const outcomes = [...purchases, ...unclaimed];
  const settledIds = new Set(outcomes.map((outcome) => outcome.optionId));
  invariant(settledIds.size === outcomes.length, 'option settled more than once');
  invariant(outcomes.every((outcome) => optionIds.includes(outcome.optionId)), 'unknown settled option');
  invariant(bids.every((bid) => optionIds.includes(bid.optionId) && playerIds.has(bid.playerId)), 'unknown bid participant/option');
  for (const player of players) {
    const spent = purchases.filter((purchase) => purchase.playerId === player.id).reduce((sum, purchase) => sum + purchase.price, 0);
    invariant(player.balance + spent === settings.startingCurrency, 'balance/ledger conservation');
  }
  for (const [index, optionId] of optionIds.entries()) {
    const auctionId = auctionIdFor(state.runId, index);
    const purchase = purchases.find((entry) => entry.optionId === optionId);
    const lost = unclaimed.find((entry) => entry.optionId === optionId);
    const optionBids = bids.filter((bid) => bid.optionId === optionId);
    let last: (typeof bids)[number] | undefined;
    for (const bid of optionBids) {
      invariant(bid.auctionId === auctionId, 'bid auction identity');
      invariant(bid.amount >= (last ? last.amount + settings.minimumBidIncrease : settings.minimumOpeningBid), 'bid minimum');
      invariant(bid.playerId !== last?.playerId, 'leader raised own bid');
      const spentBefore = purchases.filter((entry) => entry.playerId === bid.playerId && optionIds.indexOf(entry.optionId) < index).reduce((sum, entry) => sum + entry.price, 0);
      invariant(bid.amount <= settings.startingCurrency - spentBefore, 'unaffordable historical bid');
      last = bid;
    }
    if (purchase) {
      invariant(purchase.gameId === state.gameId && purchase.runId === state.runId && purchase.auctionId === auctionId, 'purchase scope');
      invariant(playerIds.has(purchase.playerId) && purchase.price >= settings.minimumOpeningBid, 'purchase player/price');
      invariant(purchase.reason === 'lastEligible'
        ? !last && purchase.price === settings.minimumOpeningBid
        : last && last.playerId === purchase.playerId && last.amount === purchase.price, 'purchase must honour the accepted price');
    }
    if (lost) {
      invariant(!last, 'binding bid discarded');
      const revealed = auction && index <= auction.optionIndex;
      invariant(lost.auctionId === (revealed ? auctionId : null), 'unclaimed auction identity');
      invariant(lost.status === (lost.reason === 'hostEnded' && !revealed ? 'unplayed' : 'unclaimed'), 'unplayed status');
      invariant(lost.reason !== 'hostSkipped' || (lost.status === 'unclaimed' && lost.auctionId !== null), 'skip status');
      if (lost.reason === 'hostEnded' || (lost.reason === 'noEligiblePlayers' && !revealed)) invariant(state.completion?.reason === lost.reason, 'unclaimed completion reason');
    }
    if (auction && index === auction.optionIndex) {
      invariant(auction.leader === null ? !last : last?.playerId === auction.leader.playerId && last.amount === auction.leader.amount, 'leader/history mismatch');
      invariant(state.phase === 'bidding' ? !settledIds.has(optionId) : settledIds.has(optionId), 'current settlement phase');
    }
    if (auction && index < auction.optionIndex) invariant(settledIds.has(optionId), 'unresolved prior option');
    if (!auction || index > auction.optionIndex) {
      invariant(!purchase && !last, 'unrevealed purchase/bid');
      if (state.phase !== 'finished') invariant(!lost, 'premature future resolution');
      if (lost) invariant(lost.auctionId === null, 'future option has an auction');
    }
  }
  if (state.phase === 'finished') invariant(settledIds.size === optionIds.length, 'incomplete result coverage');
  if (state.phase === 'bidding' && !state.paused && auction) {
    const eligible = eligiblePlayers(state, minimumBid(state)!);
    invariant(auction.leader ? eligible.some((player) => player.id !== auction.leader!.playerId) : eligible.length >= 2, 'auction has an unsettled forced result');
  }
  return state;
}
