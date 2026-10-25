import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { RoomCredentials } from '../../shared/rooms.js';

export const secretHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const seatToken = () => randomBytes(32).toString('base64url');
export const recoveryCode = () => Array.from({ length: 24 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('').match(/.{4}/g)!.join('-');
export const recoveryVerifier = (roomCode: string, code: string) => secretHash(`recovery:v1:${roomCode}:${code.replace(/[\s-]/g, '').toUpperCase()}`);

/** Private response receipts allow an interrupted bootstrap to be retried safely.
 * The request key is a 256-bit bearer secret kept by the requesting browser.
 * Store only its digest and AES-GCM ciphertext, never plaintext credentials.
 * Call save inside the same transaction as the seat mutation.
 */
export class PrivateOperations {
  private key: Buffer;
  constructor(private db: Database.Database, serverSecret: string) {
    this.key = createHmac('sha256', serverSecret).update('bid-build:private-responses:v1').digest();
  }
  context<T extends { requestKey?: string }>(scope: string, input: T) {
    const { requestKey = seatToken(), ...payload } = input;
    const keyHash = secretHash(requestKey); const requestHash = secretHash(JSON.stringify(payload));
    const aad = Buffer.from(`${scope}:${keyHash}:${requestHash}`);
    return {
      read: (): { response: RoomCredentials; matches: boolean } | null => {
        const row = this.db.prepare('SELECT request_hash, response_encrypted FROM room_operations WHERE scope = ? AND key_hash = ?').get(scope, keyHash) as { request_hash: string; response_encrypted: string } | undefined;
        if (!row) return null;
        if (row.request_hash !== requestHash) return { response: {} as RoomCredentials, matches: false };
        const bytes = Buffer.from(row.response_encrypted, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
        decipher.setAAD(aad); decipher.setAuthTag(bytes.subarray(12, 28));
        return { matches: true, response: JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as RoomCredentials };
      },
      save: (response: RoomCredentials) => {
        const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); cipher.setAAD(aad);
        const bytes = Buffer.concat([cipher.update(JSON.stringify(response), 'utf8'), cipher.final()]);
        this.db.prepare('INSERT INTO room_operations (scope, key_hash, request_hash, room_code, response_encrypted) VALUES (?, ?, ?, ?, ?)').run(scope, keyHash, requestHash, response.code, Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64'));
        return response;
      },
    };
  }
}
