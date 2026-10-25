import { credentialsSchema, tokenSchema, type RoomCredentials } from '../../../shared/rooms.js';
import type { GameTemplate } from '../../../shared/template.js';
import { sha256 } from '@noble/hashes/sha2.js';

const key = (code: string) => `bid-build.seat.${code}`;
export function storedSeat(code: string): RoomCredentials | null {
  try { const value = localStorage.getItem(key(code)); return value ? credentialsSchema.parse(JSON.parse(value)) : null; } catch { return null; }
}
export function storeSeat(seat: RoomCredentials) { localStorage.setItem(key(seat.code), JSON.stringify(credentialsSchema.parse(seat))); }
function checkStorage() {
  try { localStorage.setItem('bid-build.storage-check', 'x'.repeat(500)); localStorage.removeItem('bid-build.storage-check'); }
  catch { throw new Error('Allow browser storage before joining. Your seat needs a private credential to survive refresh.'); }
}
async function request(path: string, body: unknown, token?: string): Promise<RoomCredentials> {
  checkStorage();
  // Save a retry capability BEFORE sending. A lost response must not create a
  // second room/seat or rotate a secret twice, including after a page refresh.
  // SubtleCrypto is absent on ordinary LAN HTTP origins. Keep the exact same
  // SHA-256/UTF-8/hex format so pending retries saved by older clients still work.
  const fingerprint = Array.from(sha256(new TextEncoder().encode(JSON.stringify({ body, token })))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const pendingKey = `bid-build.request.${path}`;
  type SavedRequest = { fingerprint?: string; requestKey?: string };
  let saved: SavedRequest | null = null;
  try { saved = JSON.parse(localStorage.getItem(pendingKey) ?? 'null') as SavedRequest | null; } catch { /* replace malformed local metadata */ }
  const requestKey = saved?.fingerprint === fingerprint && tokenSchema.safeParse(saved.requestKey).success ? saved.requestKey! : btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  localStorage.setItem(pendingKey, JSON.stringify({ fingerprint, requestKey }));
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ ...body as object, requestKey }) });
  const value = await response.json() as { error?: { message: string } };
  if (!response.ok) {
    if (response.status < 500 && response.status !== 429) localStorage.removeItem(pendingKey);
    throw new Error(value.error?.message ?? 'The server could not complete this request.');
  }
  const seat = credentialsSchema.parse(value);
  const previous = storedSeat(seat.code);
  if (!seat.recoveryCode && previous?.playerId === seat.playerId) seat.recoveryCode = previous.recoveryCode;
  storeSeat(seat); localStorage.removeItem(pendingKey); return seat;
}
export const hostRoom = (template: GameTemplate, name: string) => request('/api/rooms', { template, name });
export const hostPublishedTemplate = (id: string, name: string) => request(`/api/templates/${encodeURIComponent(id)}/host`, { name });
export const joinRoom = (code: string, name: string) => request(`/api/rooms/${encodeURIComponent(code)}/join`, { name });
export const takeControl = (seat: RoomCredentials) => request(`/api/rooms/${seat.code}/takeover`, { confirmed: true }, seat.token);
export const recoverSeat = (code: string, recoveryCode: string) => request(`/api/rooms/${code}/recover`, { recoveryCode, confirmed: true });
export const replaceCode = (seat: RoomCredentials) => request(`/api/rooms/${seat.code}/recovery-code`, {}, seat.token);
export const ensureCode = (seat: RoomCredentials) => request(`/api/rooms/${seat.code}/recovery-code`, { replace: false }, seat.token);
