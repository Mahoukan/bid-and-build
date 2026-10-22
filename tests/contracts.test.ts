import { describe, expect, it } from 'vitest';
import { defaultAuctionSettings } from '../engine/index.js';
import { auctionSettingsSchema, healthSchema, wholeCurrencySchema } from '../shared/contracts.js';

describe('shared foundation contracts', () => {
  it('accepts the agreed default settings and distinct opening/raise amounts', () => {
    expect(auctionSettingsSchema.parse(defaultAuctionSettings())).toEqual({
      startingCurrency: 20, currencySymbol: '$', minimumOpeningBid: 1, minimumBidIncrease: 1,
    });
    expect(auctionSettingsSchema.safeParse({ ...defaultAuctionSettings(), minimumOpeningBid: 2 }).success).toBe(true);
  });
  it.each([-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1_000_001, '20'])(
    'rejects invalid or oversized currency: %s', (amount) => {
      expect(wholeCurrencySchema.safeParse(amount).success).toBe(false);
    },
  );
  it('rejects unaffordable openings, oversized labels, and unexpected properties', () => {
    expect(auctionSettingsSchema.safeParse({ ...defaultAuctionSettings(), minimumOpeningBid: 21 }).success).toBe(false);
    expect(auctionSettingsSchema.safeParse({ ...defaultAuctionSettings(), currencySymbol: 'x'.repeat(9) }).success).toBe(false);
    expect(auctionSettingsSchema.safeParse({ ...defaultAuctionSettings(), secret: 'x' }).success).toBe(false);
    expect(healthSchema.safeParse({ status: 'ready' }).success).toBe(false);
  });
});
