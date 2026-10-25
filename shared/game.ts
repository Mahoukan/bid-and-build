import { z } from 'zod';
import { auctionSettingsSchema, wholeCurrencySchema } from './contracts.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
export const MAX_OPTIONS = 200;
export const MAX_RUN_NUMBER = 1_000_000;

export const entityIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const scopedIdSchema = z.string().min(1).max(96).regex(/^[A-Za-z0-9_:-]+$/);
export const phaseSchema = z.enum(['lobby', 'bidding', 'reveal', 'finished']);
const playerIdentitySchema = z.strictObject({
  id: entityIdSchema,
  name: z.string().trim().min(1).max(40),
});
const optionIdsSchema = z.array(entityIdSchema).min(1).max(MAX_OPTIONS)
  .refine((ids) => new Set(ids).size === ids.length, 'Option IDs must be unique.');
const playersSchema = z.array(playerIdentitySchema).min(1).max(MAX_PLAYERS)
  .refine((players) => new Set(players.map((player) => player.id)).size === players.length, 'Player IDs must be unique.');

// Private engine input: content/images belong to the separate template snapshot.
// One host may wait in a lobby; Start enforces the two-player minimum.
export const gameInputSchema = z.strictObject({
  gameId: entityIdSchema,
  hostPlayerId: entityIdSchema,
  settings: auctionSettingsSchema,
  optionIds: optionIdsSchema,
  players: playersSchema,
}).refine((game) => game.players.some((player) => player.id === game.hostPlayerId), {
  message: 'The host must occupy an existing player seat.', path: ['hostPlayerId'],
});

export const leadingBidSchema = z.strictObject({ playerId: entityIdSchema, amount: wholeCurrencySchema });
export const bidSchema = z.strictObject({
  commandId: entityIdSchema,
  auctionId: scopedIdSchema,
  optionId: entityIdSchema,
  playerId: entityIdSchema,
  amount: wholeCurrencySchema,
});
export const purchaseSchema = z.strictObject({
  gameId: entityIdSchema,
  runId: scopedIdSchema,
  auctionId: scopedIdSchema,
  optionId: entityIdSchema,
  playerId: entityIdSchema,
  price: wholeCurrencySchema,
  reason: z.enum(['bid', 'lastEligible']),
});
export const unclaimedSchema = z.strictObject({
  optionId: entityIdSchema,
  auctionId: scopedIdSchema.nullable(),
  status: z.enum(['unclaimed', 'unplayed']),
  reason: z.enum(['hostSkipped', 'noEligiblePlayers', 'hostEnded']),
});
export const completionSchema = z.strictObject({
  status: z.enum(['complete', 'incomplete']),
  reason: z.enum(['allOptionsResolved', 'noEligiblePlayers', 'hostEnded']),
});

// Structural schema; engine/state.ts adds financial and phase invariants.
export const gameStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  gameId: entityIdSchema,
  runNumber: z.number().int().min(1).max(MAX_RUN_NUMBER),
  runId: scopedIdSchema,
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  hostPlayerId: entityIdSchema,
  settings: auctionSettingsSchema,
  optionIds: optionIdsSchema,
  players: z.array(playerIdentitySchema.extend({ balance: z.number().int().min(0).max(1_000_000), sittingOut: z.boolean().default(false) })).min(1).max(MAX_PLAYERS),
  phase: phaseSchema,
  paused: z.boolean(),
  currentAuction: z.strictObject({
    id: scopedIdSchema,
    optionId: entityIdSchema,
    optionIndex: z.number().int().min(0).max(MAX_OPTIONS - 1),
    leader: leadingBidSchema.nullable(),
    concededPlayerIds: z.array(entityIdSchema).max(MAX_PLAYERS),
  }).nullable(),
  bids: z.array(bidSchema),
  purchases: z.array(purchaseSchema).max(MAX_OPTIONS),
  unclaimed: z.array(unclaimedSchema).max(MAX_OPTIONS),
  completion: completionSchema.nullable(),
});

const context = {
  commandId: entityIdSchema,
  gameId: entityIdSchema,
  runId: scopedIdSchema,
  auctionId: scopedIdSchema.nullable(),
  phase: phaseSchema,
};
export const gameCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...context, type: z.literal('start') }),
  z.strictObject({ ...context, type: z.literal('bid'), amount: wholeCurrencySchema }),
  z.strictObject({ ...context, type: z.literal('giveUp') }),
  z.strictObject({ ...context, type: z.literal('skip') }),
  z.strictObject({ ...context, type: z.literal('next') }),
  z.strictObject({ ...context, type: z.literal('pause') }),
  z.strictObject({ ...context, type: z.literal('resume') }),
  z.strictObject({ ...context, type: z.literal('sitOut'), playerId: entityIdSchema, confirmed: z.literal(true) }),
  z.strictObject({ ...context, type: z.literal('end'), confirmed: z.literal(true) }),
  z.strictObject({ ...context, type: z.literal('playAgain') }),
]);

export const engineEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('gameStarted'), runId: scopedIdSchema }),
  z.strictObject({ type: z.literal('auctionOpened'), auctionId: scopedIdSchema, optionId: entityIdSchema, optionIndex: z.number().int().min(0).max(MAX_OPTIONS - 1) }),
  z.strictObject({ type: z.literal('bidAccepted'), bid: bidSchema }),
  z.strictObject({ type: z.literal('playerConceded'), auctionId: scopedIdSchema, playerId: entityIdSchema }),
  z.strictObject({ type: z.literal('optionPurchased'), purchase: purchaseSchema }),
  z.strictObject({ type: z.literal('optionUnclaimed'), option: unclaimedSchema }),
  z.strictObject({ type: z.literal('gamePaused'), playerId: entityIdSchema }),
  z.strictObject({ type: z.literal('gameResumed'), playerId: entityIdSchema }),
  z.strictObject({ type: z.literal('playerSatOut'), playerId: entityIdSchema }),
  z.strictObject({ type: z.literal('gameFinished'), completion: completionSchema }),
  z.strictObject({ type: z.literal('gameReset'), previousRunId: scopedIdSchema, runId: scopedIdSchema }),
]);

export type GameInput = z.infer<typeof gameInputSchema>;
export type GameState = z.infer<typeof gameStateSchema>;
export type GameCommand = z.infer<typeof gameCommandSchema>;
export type EngineEvent = z.infer<typeof engineEventSchema>;
export type Purchase = z.infer<typeof purchaseSchema>;
export type UnclaimedOption = z.infer<typeof unclaimedSchema>;

export type EngineErrorCode =
  | 'INVALID_STATE' | 'INVALID_COMMAND' | 'INVALID_ACTOR' | 'HOST_REQUIRED'
  | 'STALE_GAME' | 'STALE_RUN' | 'STALE_AUCTION' | 'STALE_PHASE'
  | 'WRONG_PHASE' | 'GAME_FINISHED' | 'PAUSED' | 'ALREADY_PAUSED' | 'NOT_PAUSED'
  | 'PLAYER_COUNT' | 'LEADER_COMMITTED' | 'ALREADY_CONCEDED' | 'BID_TOO_LOW'
  | 'INSUFFICIENT_FUNDS' | 'BID_EXISTS' | 'RUN_LIMIT' | 'REVISION_LIMIT' | 'SITTING_OUT' | 'INVALID_SIT_OUT';

export type TransitionResult =
  | { ok: true; state: GameState; events: EngineEvent[] }
  | { ok: false; state: GameState; events: []; error: { code: EngineErrorCode; message: string; minimumBid?: number } };
