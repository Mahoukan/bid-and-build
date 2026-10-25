import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { roomCodeSchema, tokenSchema, type RoomClientEvents, type RoomServerEvents, type RoomSnapshot } from '../../../shared/rooms.js';
import { GameBoard } from './GameBoard.js';

function readAccess(code: string) {
  const key = `bid-build.display.${code}`;
  const fragment = new URLSearchParams(location.hash.slice(1)).get('access');
  // Fragments never reach HTTP logs/referrers; scrub even invalid values.
  if (location.hash) history.replaceState(null, '', location.pathname);
  try {
    if (fragment && tokenSchema.safeParse(fragment).success) sessionStorage.setItem(key, fragment);
    const value = sessionStorage.getItem(key); return tokenSchema.safeParse(value).success ? value : null;
  } catch { return fragment && tokenSchema.safeParse(fragment).success ? fragment : null; }
}
function DisplayRoom({ code }: { code: string }) {
  const [token] = useState(() => readAccess(code)); const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false); const [status, setStatus] = useState('Connecting shared display…'); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!token || !roomCodeSchema.safeParse(code).success) return;
    const client: Socket<RoomServerEvents, RoomClientEvents> = io({ auth: { code, displayToken: token } });
    client.on('connect', () => { setConnected(true); setStatus('Shared display connected'); });
    client.on('room:snapshot', (next) => setSnapshot((current) => !current || next.revision >= current.revision ? next : current));
    client.on('disconnect', () => { setConnected(false); setStatus('Disconnected — the board may be out of date'); });
    client.on('connect_error', () => { setConnected(false); setStatus('Display unavailable. Check the connection or open a fresh display link from a player’s menu.'); });
    return () => { client.removeAllListeners(); client.disconnect(); };
  }, [code, token, attempt]);
  if (!token || !roomCodeSchema.safeParse(code).success) return <section className="room-entry"><h1>Open a shared display</h1><p>In your game, choose Game menu → Open shared display. Use that display link on this screen. A room code alone cannot open a display.</p><Link to="/">Home</Link></section>;
  const retry = <button className="game-button" onClick={() => setAttempt((value) => value + 1)}>Reconnect display</button>;
  return snapshot ? <GameBoard key={snapshot.runId} snapshot={snapshot} access={{ code, token, display: true }} connected={connected} status={status} connectionControls={retry} /> : <section className="room-entry"><h1>Shared display</h1><p role="status">{status}</p>{retry}</section>;
}
export default function Display() { const { code = '' } = useParams(); return <DisplayRoom key={code} code={code.toUpperCase()} />; }
