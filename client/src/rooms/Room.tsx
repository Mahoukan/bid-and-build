import { useServerReady } from '../serverConnection.js';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { roomCodeSchema, type RoomCredentials } from '../../../shared/rooms.js';
import { joinRoom, storedSeat, takeControl } from './api.js';
import { GameBoard } from './GameBoard.js';
import { usePlayerRoom } from './usePlayerRoom.js';
import { Modal } from './ui.js';
import { RecoveryForm } from './Recovery.js';

function PlayerRoom({ code, seat, replaceSeat, recover }: { code: string; seat: RoomCredentials; replaceSeat: (seat: RoomCredentials) => void; recover: () => void }) {
  const room = usePlayerRoom(code, seat); const [takeover, setTakeover] = useState(false);
  const connectionControls = !room.connected && <div className="menu-actions"><button className="game-button" onClick={room.retry}>Retry connection</button>{room.controlConflict && <button className="game-button bid-button" onClick={() => setTakeover(true)}>Take control here</button>}<button className="game-button" onClick={recover}>Recover with private code</button></div>;
  const pendingControls = room.pending && <div><p>Checking your previous action. It will not be replayed.</p><button className="game-button" disabled={!room.connected || room.resolving} onClick={() => void room.resolvePending()}>Check receipt</button></div>;
  return <>{room.snapshot ? <GameBoard key={room.snapshot.runId} snapshot={room.snapshot} access={{ code, token: seat.token }} seat={seat} connected={room.connected} status={room.status} locked={!room.connected || !!room.pending} act={room.act} message={room.error || room.notice} connectionControls={connectionControls} pendingControls={pendingControls} /> : <section className="room-entry"><h1>Your game room</h1><p role="status">{room.status}</p>{room.error && <p role="alert">{room.error}</p>}{connectionControls}<Link to="/">Back home</Link></section>}
    {takeover && <Modal title="Take control here?" close={() => setTakeover(false)}><div className="dialog-body"><p>The other tab will lose control when this connection takes its place. Any existing pause still needs the host to Resume.</p></div><div className="dialog-footer"><button className="game-button" onClick={() => setTakeover(false)}>Cancel</button><button className="game-button bid-button" onClick={() => { void takeControl(seat).then(replaceSeat).catch((cause: unknown) => room.setError(cause instanceof Error ? cause.message : 'Takeover failed.')); setTakeover(false); }}>Confirm takeover</button></div></Modal>}
  </>;
}
function RoomEntry({ code }: { code: string }) {
  const ready = useServerReady();
  const [seat, setSeat] = useState(() => storedSeat(code));
  const [recovering, setRecovering] = useState(false);
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (!roomCodeSchema.safeParse(code).success) return <section className="room-entry"><h1>Invalid room code</h1><p>Use the eight-character code from your host.</p><Link to="/">Back home</Link></section>;
  if (recovering) return <RecoveryForm code={code} recovered={(next) => { setSeat(next); setRecovering(false); }} cancel={() => setRecovering(false)} />;
  if (seat) return <PlayerRoom key={seat.token} code={code} seat={seat} replaceSeat={setSeat} recover={() => setRecovering(true)} />;
  return <section className="room-entry"><p className="eyebrow">Room {code}</p><h1>Take your seat</h1><p>2–5 players including the host. Seats close when play starts.</p>{!ready && <p role="status">Connecting to the server. Joining is disabled until it responds.</p>}<form onSubmit={(event) => { event.preventDefault(); setBusy(true); setError(''); void joinRoom(code, name).then(setSeat).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Join failed.')).finally(() => setBusy(false)); }}><label htmlFor="player-name">Your player name</label><input id="player-name" value={name} maxLength={40} required onChange={(event) => setName(event.target.value)} /><button className="game-button bid-button" disabled={busy || !ready || !name.trim()}>{busy ? 'Joining…' : 'Join game'}</button></form>{error && <p role="alert">{error}</p>}<p className="small-note">Use a separate browser profile for another player. Your saved seat returns when you refresh here.</p><button className="game-button" onClick={() => setRecovering(true)}>Recover an existing seat</button><Link to="/">Back home</Link></section>;
}
export default function Room() { const { code = '' } = useParams(); return <RoomEntry key={code} code={code.toUpperCase()} />; }
