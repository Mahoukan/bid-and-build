import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { passwordSchema } from '../../shared/admin.js';

// Stable built-in Node 24 API; OWASP scrypt baseline, with explicit memory headroom.
const parameters = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, parameters, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string): Promise<string> {
  passwordSchema.parse(password);
  const salt = randomBytes(16); const key = await derive(password, salt);
  return `scrypt-v1:${salt.toString('hex')}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string | undefined): Promise<boolean> {
  const match = encoded?.match(/^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{128})$/);
  // An unknown/disabled account still incurs the same password-hashing work.
  const actual = await derive(password, match ? Buffer.from(match[1]!, 'hex') : Buffer.alloc(16, 0x72));
  const expected = match ? Buffer.from(match[2]!, 'hex') : Buffer.alloc(64);
  return timingSafeEqual(actual, expected) && !!match;
}
