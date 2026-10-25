import { createHmac, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import type { AppConfig } from '../config.js';
import { loginSchema, type AdminSession } from '../../shared/admin.js';
import { RoomFailure } from '../rooms/service.js';
import { secretHash, seatToken } from '../rooms/secrets.js';
import { verifyPassword } from './passwords.js';

export const SESSION_LIFETIME = 12 * 60 * 60_000;
export const SESSION_IDLE = 2 * 60 * 60_000;
type SessionRow = { token_hash: string; account_id: string; username: string; is_admin: number; last_seen: number; expires_at: number };
export class AdminAuth {
  private hashing = 0;
  readonly cookieName: string;
  constructor(private db: Database.Database, private config: AppConfig) {
    this.cookieName = config.mode === 'production' ? '__Host-bid_build_admin' : 'bid_build_admin';
  }
  limit(key: string, maximum: number, duration: number) {
    const now = Date.now(); const digest = secretHash(key);
    const allowed = this.db.transaction(() => {
      this.db.prepare('DELETE FROM request_limits WHERE until_at <= ?').run(now);
      const row = this.db.prepare('SELECT count FROM request_limits WHERE key_hash = ?').get(digest) as { count: number } | undefined;
      if (row) { this.db.prepare('UPDATE request_limits SET count = count + 1 WHERE key_hash = ?').run(digest); return row.count < maximum; }
      if ((this.db.prepare('SELECT COUNT(*) AS n FROM request_limits').get() as { n: number }).n >= 10000) return false;
      this.db.prepare('INSERT INTO request_limits (key_hash, count, until_at) VALUES (?, 1, ?)').run(digest, now + duration); return true;
    }).immediate();
    if (!allowed) throw new RoomFailure('RATE_LIMIT', 'Too many attempts. Wait before trying again.', 429);
  }
  origin(req: Request) {
    if (req.headers.origin !== this.config.appOrigin) throw new RoomFailure('BAD_ORIGIN', 'Use the configured website address.', 403);
  }
  private token(req: Request) {
    const entries = (req.headers.cookie ?? '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${this.cookieName}=`));
    if (entries.length !== 1) return null;
    const token = entries[0]!.slice(this.cookieName.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  }
  private csrf(token: string) { return createHmac('sha256', this.config.sessionSecret).update(`admin:csrf:v1:${token}`).digest('base64url'); }
  cookie(res: Response, token: string | null) {
    res.cookie(this.cookieName, token ?? '', { httpOnly: true, secure: this.config.mode === 'production', sameSite: 'strict', path: '/', maxAge: token ? SESSION_LIFETIME : 0 });
  }
  private find(req: Request): { row: SessionRow; token: string } | null {
    const now = Date.now();
    this.db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ? OR last_seen <= ?').run(now, now - SESSION_IDLE);
    const token = this.token(req); if (!token) return null;
    const row = this.db.prepare('SELECT s.*, a.username, a.is_admin FROM admin_sessions s JOIN admin_accounts a ON a.id = s.account_id WHERE s.token_hash = ?').get(secretHash(token)) as SessionRow | undefined;
    if (!row) return null;
    if (!row.is_admin) throw new RoomFailure('ADMIN_REQUIRED', 'Administrator permission is required.', 403);
    return { row, token };
  }
  require(req: Request, write = false) {
    const session = this.find(req);
    if (!session) throw new RoomFailure('SIGN_IN_REQUIRED', 'Sign in as an administrator.', 401);
    if (write) {
      this.origin(req); const supplied = req.headers['x-csrf-token'];
      if (typeof supplied !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(this.csrf(session.token)))) throw new RoomFailure('BAD_CSRF', 'Refresh your administrator session before saving.', 403);
    }
    this.db.prepare('UPDATE admin_sessions SET last_seen = ? WHERE token_hash = ?').run(Date.now(), session.row.token_hash);
    return session;
  }
  status(req: Request): AdminSession {
    const session = this.find(req); if (!session) return { authenticated: false };
    this.db.prepare('UPDATE admin_sessions SET last_seen = ? WHERE token_hash = ?').run(Date.now(), session.row.token_hash);
    return { authenticated: true, username: session.row.username, csrfToken: this.csrf(session.token), expiresAt: session.row.expires_at };
  }
  async login(req: Request, res: Response): Promise<AdminSession> {
    this.origin(req);
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new RoomFailure('INVALID_LOGIN', 'Check your administrator name and password.', 401);
    this.limit(`login:name:${parsed.data.username}`, 10, 15 * 60_000);
    if (this.hashing >= 2) throw new RoomFailure('AUTH_BUSY', 'Sign-in is busy. Try again shortly.', 503);
    this.hashing++;
    try {
      const account = this.db.prepare('SELECT id, username, password_hash, is_admin FROM admin_accounts WHERE username = ?').get(parsed.data.username) as { id: string; username: string; password_hash: string; is_admin: number } | undefined;
      const valid = await verifyPassword(parsed.data.password, account?.password_hash);
      if (!valid || !account?.is_admin) throw new RoomFailure('INVALID_LOGIN', 'Check your administrator name and password.', 401);
      // Reset/revocation during the asynchronous KDF must not create a new session.
      const current = this.db.prepare('SELECT 1 FROM admin_accounts WHERE id = ? AND password_hash = ? AND is_admin = 1').get(account.id, account.password_hash);
      if (!current) throw new RoomFailure('INVALID_LOGIN', 'Check your administrator name and password.', 401);
      const token = seatToken(); const now = Date.now();
      this.db.transaction(() => {
        const old = this.token(req); if (old) this.db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(secretHash(old));
        this.db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ? OR last_seen <= ?').run(now, now - SESSION_IDLE);
        // Bound durable sessions even when a client keeps signing in without cookies.
        this.db.prepare('DELETE FROM admin_sessions WHERE account_id = ? AND token_hash NOT IN (SELECT token_hash FROM admin_sessions WHERE account_id = ? ORDER BY created_at DESC LIMIT 9)').run(account.id, account.id);
        this.db.prepare('INSERT INTO admin_sessions (token_hash, account_id, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?)').run(secretHash(token), account.id, now, now, now + SESSION_LIFETIME);
      }).immediate();
      this.cookie(res, token);
      return { authenticated: true, username: account.username, csrfToken: this.csrf(token), expiresAt: now + SESSION_LIFETIME };
    } finally { this.hashing--; }
  }
  logout(req: Request, res: Response) {
    const session = this.require(req, true);
    this.db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(session.row.token_hash); this.cookie(res, null);
  }
}
