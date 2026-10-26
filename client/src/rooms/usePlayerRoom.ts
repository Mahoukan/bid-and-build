import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { GameCommand } from '../../../shared/game.js';
import { receiptQuerySchema, type RoomClientEvents, type RoomCredentials, type RoomReply, type RoomServerEvents, type RoomSnapshot } from '../../../shared/rooms.js';
import { newLocalId } from '../builder/model.js';
import { ensureCode } from './api.js';
import { useServerReady } from '../serverConnection.js';
type RoomSocket = Socket<RoomServerEvents, RoomClientEvents>;
type Pending = { commandId: string; runId: string };
export type Action = { type: Exclude<GameCommand['type'], 'bid' | 'end' | 'sitOut'> } | { type: 'bid'; amount: number } | { type: 'end'; confirmed: true } | { type: 'sitOut'; playerId: string; confirmed: true };
const pendingKey = (code: string) => `bid-build.pending.${code}`;
function readPending(code: string): Pending | null {
  try { const parsed = receiptQuerySchema.safeParse(JSON.parse(sessionStorage.getItem(pendingKey(code)) ?? 'null')); return parsed.success ? parsed.data : null; } catch { return null; }
}
export function usePlayerRoom(code: string, seat: RoomCredentials) {
  const serverReady = useServerReady();
  const synchronized = useRef(false);
  const socket = useRef<RoomSocket | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [status, setStatus] = useState('Connecting…');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [controlConflict, setControlConflict] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<Pending | null>(() => readPending(code));
  const [resolving, setResolving] = useState(false);
  const pendingRef = useRef(pending);
  useEffect(() => {
    if (!connected || seat.recoveryCode) return;
    // Upgrade a legacy seat without silently replacing an existing private code.
    let current = true;
    void ensureCode(seat).then((next) => { if (current && next.recoveryCode) setNotice('Your private recovery code is ready in Game menu. Keep a private copy.'); }).catch(() => { if (current) setNotice('Open Game menu to generate a private recovery code before changing devices.'); });
    return () => { current = false; };
  }, [connected, seat]);
  function receive(next: RoomSnapshot) { setSnapshot((current) => !current || next.revision >= current.revision ? next : current); }
  function clearPending() { try { sessionStorage.removeItem(pendingKey(code)); } catch { /* A future reload can safely query this receipt again. */ } pendingRef.current = null; setPending(null); }
  function result(reply: RoomReply) {
    if (!reply.ok) { setError(reply.error.message); return false; }
    receive(reply.snapshot);
    if (reply.receipt) {
      if (!reply.receipt.ok) setError(reply.receipt.error?.message ?? 'Action rejected.');
      else { setError(''); setNotice(''); }
    }
    return true;
  }
  async function resolvePending(client = socket.current) {
    const query = pendingRef.current;
    if (!client?.connected || !query) return;
    setResolving(true);
    try {
      const reply = await client.timeout(5000).emitWithAck('room:receipt', query);
      if (result(reply)) {
        if (!reply.receipt) setNotice('No receipt was found. Review the current state before making a new action. Nothing was automatically retried.');
        clearPending();
      }
    } catch { setError('Receipt lookup is still unavailable. Reconnect or check again before bidding.'); }
    finally { setResolving(false); }
  }
  useEffect(() => {
    if (!serverReady) return;
    const client: RoomSocket = io({ auth: { code, token: seat.token }, autoConnect: false, reconnectionDelay: 500, reconnectionDelayMax: 2000 });
    let conflictRetries = 0; let retryTimer: ReturnType<typeof setTimeout> | undefined;
    socket.current = client;
    client.on('connect', () => {
      synchronized.current = false;
      setConnected(false); setStatus('Restoring current game state…'); setControlConflict(false); setError('');
    });
    client.on('room:snapshot', (next) => {
      const first = !synchronized.current;
      receive(next); synchronized.current = true; setConnected(true); setStatus('Connected');
      if (first && pendingRef.current) void resolvePending(client);
    });
    client.on('disconnect', () => { synchronized.current = false; setConnected(false); setStatus('Connection lost — reconnecting. Actions are disabled.'); });
    client.on('connect_error', (cause) => {
      const reason = (cause as Error & { data?: { code: string } }).data?.code;
      // During refresh, the old socket's close may arrive just after this
      // handshake. Briefly retry ordinary attach; never silently take over.
      if (reason === 'CONTROL_ACTIVE' && conflictRetries++ < 3) {
        retryTimer = setTimeout(() => client.connect(), 500); return;
      }
      setConnected(false); setStatus('Connection unavailable'); setError(cause.message);
      setControlConflict(reason === 'CONTROL_ACTIVE');
    });
    client.on('room:revoked', (message) => { setError(message); setConnected(false); setControlConflict(false); setStatus('Control transferred'); });
    client.connect();
    return () => { synchronized.current = false; setConnected(false); clearTimeout(retryTimer); socket.current = null; client.removeAllListeners(); client.disconnect(); };
    // Each connection owns these callbacks; changing received state must not reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, seat.token, attempt, serverReady]);

  async function act(action: Action) {
    if (!serverReady || !synchronized.current || !snapshot || !socket.current?.connected || pendingRef.current) return;
    const command = { ...action, commandId: newLocalId(), gameId: snapshot.gameId, runId: snapshot.runId, auctionId: snapshot.current?.auctionId ?? null, phase: snapshot.phase } as GameCommand;
    const query = { commandId: command.commandId, runId: command.runId };
    try { sessionStorage.setItem(pendingKey(code), JSON.stringify(query)); }
    catch { setError('Allow session storage before sending an action so an interrupted acknowledgement can be checked safely.'); return; }
    pendingRef.current = query; setPending(query); setError(''); setNotice('');
    try {
      // Never let Socket.IO buffer a command for a later transport connection.
      const reply = await socket.current.volatile.timeout(5000).emitWithAck('room:command', command);
      if (result(reply)) clearPending();
      else await resolvePending();
    } catch { setError('Acknowledgement interrupted. Checking the original command; it will not be replayed.'); await resolvePending(); }
  }
  return { snapshot, status: serverReady ? status : 'Connection lost or connecting — waiting for the server.', connected: connected && serverReady, error, notice, controlConflict, pending, resolving, act, resolvePending, setError, retry: () => setAttempt((value) => value + 1) };
}
