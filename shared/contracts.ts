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

// Infrastructure only. No player identities or room data exist in Milestone 1.
export interface ServerToClientEvents {
  'server:ready': (payload: { protocolVersion: 1 }) => void;
}
export type ClientToServerEvents = Record<string, never>;
