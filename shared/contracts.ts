import { z } from 'zod';

export const wholeCurrencySchema = z.number().int().min(1).max(1_000_000);
export const auctionSettingsSchema = z.strictObject({
  startingCurrency: wholeCurrencySchema,
  currencySymbol: z.string().trim().min(1).max(8),
  minimumOpeningBid: wholeCurrencySchema,
  minimumBidIncrease: wholeCurrencySchema,
}).refine((settings) => settings.startingCurrency >= settings.minimumOpeningBid, {
  message: 'Starting currency must cover the opening price.',
  path: ['startingCurrency'],
});

export type AuctionSettings = z.infer<typeof auctionSettingsSchema>;

export { healthSchema, type Health } from './health.js';

// Transport events live in rooms.ts; engine rules remain transport-independent.
