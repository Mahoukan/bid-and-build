import type { AuctionSettings } from '../shared/contracts.js';

// Pure module boundary. Auction transitions will be implemented in Milestone 2.
export function defaultAuctionSettings(): AuctionSettings {
  return {
    startingCurrency: 20,
    currencySymbol: '$',
    minimumOpeningBid: 1,
    minimumBidIncrease: 1,
  };
}
