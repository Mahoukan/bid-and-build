import type { AuctionSettings } from '../shared/contracts.js';

export { createGame, transition } from './transition.js';
export { minimumBid, parseGameState } from './state.js';
export type { GameState, GameCommand, GameInput, EngineEvent, TransitionResult } from '../shared/game.js';

export function defaultAuctionSettings(): AuctionSettings {
  return {
    startingCurrency: 20,
    currencySymbol: '$',
    minimumOpeningBid: 1,
    minimumBidIncrease: 1,
  };
}
