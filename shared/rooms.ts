import { z } from 'zod';
import { auctionSettingsSchema } from './contracts.js';
import { entityIdSchema, phaseSchema, completionSchema, gameCommandSchema, scopedIdSchema } from './game.js';
import { templateSchema } from './template.js';

export const roomCodeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/);
export const playerNameSchema = z.string().trim().min(1, 'Enter your player name.').max(40);
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const recoveryCodeSchema = z.string().max(40).transform((value) => value.toUpperCase().replace(/[\s-]/g, '')).pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{24}$/));
export const operationSchema = z.strictObject({ requestKey: tokenSchema.optional() });
export const createRoomSchema = operationSchema.extend({ name: playerNameSchema, template: templateSchema });
export const joinRoomSchema = operationSchema.extend({ name: playerNameSchema });
export const recoverRoomSchema = operationSchema.extend({ recoveryCode: recoveryCodeSchema, confirmed: z.literal(true) });
export const takeoverSchema = operationSchema.extend({ confirmed: z.literal(true) });
export const issueRecoverySchema = operationSchema.extend({ replace: z.boolean().default(true) });
export const credentialsSchema = z.strictObject({ code: roomCodeSchema, playerId: entityIdSchema, token: tokenSchema, recoveryCode: z.string().regex(/^(?:[A-HJ-NP-Z2-9]{4}-){5}[A-HJ-NP-Z2-9]{4}$/).optional() });
export type RoomCredentials = z.infer<typeof credentialsSchema>;
export const roomAuthSchema = z.strictObject({ code: roomCodeSchema, token: tokenSchema });
export const displayAuthSchema = z.strictObject({ code: roomCodeSchema, displayToken: tokenSchema });
export const receiptQuerySchema = z.strictObject({ runId: scopedIdSchema, commandId: entityIdSchema });
export type CommandReceipt = {
  commandId: string; runId: string; ok: boolean; revision: number;
  error?: { code: string; message: string; minimumBid?: number };
};
export type RoomError = { code: string; message: string };
export type RoomOption = { id: string; title: string; description: string; imageAssetId: string | null };
export type RoomManifest = {
  title: string; description: string; coverAssetId: string | null;
  options: RoomOption[];
};
export interface RoomSnapshot {
  schemaVersion: 1;
  code: string; gameId: string; runId: string; revision: number;
  title: string; description: string; coverAssetId: string | null;
  hostPlayerId: string; phase: z.infer<typeof phaseSchema>; paused: boolean;
  pauseReason: 'host' | 'disconnect' | 'restart' | null;
  settings: z.infer<typeof auctionSettingsSchema>;
  players: { id: string; name: string; balance: number; connected: boolean; sittingOut: boolean }[];
  optionCount: number;
  current: { auctionId: string; index: number; option: RoomOption; leader: { playerId: string; amount: number } | null; concededPlayerIds: string[] } | null;
  revealedOptions: RoomOption[];
  purchases: { optionId: string; playerId: string; price: number; reason: 'bid' | 'lastEligible' }[];
  bids: { optionId: string; playerId: string; amount: number }[];
  unclaimed: { optionId: string; status: 'unclaimed' | 'unplayed' }[];
  unrevealedCount: number;
  completion: z.infer<typeof completionSchema> | null;
  minimumBid: number | null;
  revealAt: number | null;
}
export type RoomReply = { ok: true; snapshot: RoomSnapshot; receipt?: CommandReceipt | null } | { ok: false; error: RoomError };
export interface RoomServerEvents {
  'server:ready': (payload: { protocolVersion: 1 }) => void;
  'room:snapshot': (snapshot: RoomSnapshot) => void;
  'room:revoked': (message: string) => void;
}
export interface RoomClientEvents {
  'room:sync': (ack: (reply: RoomReply) => void) => void;
  'room:command': (command: z.infer<typeof gameCommandSchema>, ack: (reply: RoomReply) => void) => void;
  'room:receipt': (query: z.infer<typeof receiptQuerySchema>, ack: (reply: RoomReply) => void) => void;
}
