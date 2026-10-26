import { serverRequest } from '../serverConnection.js';
import { AppearanceButton } from '../appearance/Appearance.js';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { RoomCredentials, RoomSnapshot } from '../../../shared/rooms.js';
import { displayAuthSchema } from '../../../shared/rooms.js';
import type { Action } from './usePlayerRoom.js';
import { Modal } from './ui.js';
import { RecoveryPanel } from './Recovery.js';

export const money = (snapshot: RoomSnapshot, amount: number) => `${snapshot.settings.currencySymbol}${amount}`;
export const playerName = (snapshot: RoomSnapshot, id: string) => snapshot.players.find((player) => player.id === id)?.name ?? 'Player';

export function BidActions({ snapshot, seat, locked, act }: { snapshot: RoomSnapshot; seat: RoomCredentials; locked: boolean; act: (action: Action) => Promise<void> }) {
  const [panel, setPanel] = useState<'custom' | 'all' | null>(null); const [amount, setAmount] = useState('');
  const me = snapshot.players.find((player) => player.id === seat.playerId)!;
  const minimum = snapshot.minimumBid ?? snapshot.settings.minimumOpeningBid;
  const leader = snapshot.current?.leader?.playerId === me.id;
  const conceded = snapshot.current?.concededPlayerIds.includes(me.id);
  const disabled = locked || snapshot.paused || leader || conceded || me.sittingOut;
  const cannotBid = !!disabled || me.balance < minimum;
  const outbid = !leader && snapshot.bids.some((bid) => bid.optionId === snapshot.current?.option.id && bid.playerId === me.id);
  const hint = me.sittingOut ? 'Sitting out this run. Existing bids still stand.' : snapshot.paused ? 'Paused · existing bids still stand.' : leader ? 'You lead. Your bid is binding.' : conceded ? 'You gave up. Rejoin next option.' : me.balance < minimum ? 'Insufficient funds for the next bid.' : outbid ? 'You were outbid. Raise or give up.' : 'Your move · no countdown.';
  const offered = Number(amount); const valid = amount.trim() !== '' && Number.isSafeInteger(offered) && offered >= minimum && offered <= me.balance;
  return <><div className="action-summary"><strong>Your balance <span>{money(snapshot, me.balance)}</span></strong><p role="status">{hint}</p></div><div className="primary-actions">
    <button className="game-button bid-button" disabled={cannotBid} onClick={() => void act({ type: 'bid', amount: minimum })}>Bid {money(snapshot, minimum)}</button>
    <button className="game-button" disabled={!!disabled || me.balance < snapshot.settings.minimumOpeningBid} onClick={() => void act({ type: 'giveUp' })}>Give Up</button>
    <button className="game-button" aria-label="More bid options" disabled={cannotBid} onClick={() => setPanel('custom')}>More</button>
  </div>{panel && <Modal title={panel === 'custom' ? 'Choose your bid' : 'Confirm Bet All'} close={() => setPanel(null)}>
    {panel === 'custom' ? <form className="bid-form" onSubmit={(event) => { event.preventDefault(); if (valid && !cannotBid) { void act({ type: 'bid', amount: offered }); setPanel(null); } }}>
      <div className="dialog-body"><label htmlFor="custom-bid">Bid amount</label><input id="custom-bid" autoFocus type="number" inputMode="numeric" min={minimum} max={me.balance} step={1} value={amount} onChange={(event) => setAmount(event.target.value)} /><p>Minimum {money(snapshot, minimum)} · Balance {money(snapshot, me.balance)}</p></div>
      <div className="dialog-footer"><button type="button" className="game-button" onClick={() => setPanel(null)}>Cancel</button><button className="game-button bid-button" disabled={!valid || cannotBid}>Confirm bid</button></div>
      <div className="secondary-bet"><button type="button" className="game-button" onClick={() => setPanel('all')}>Bet All…</button></div>
    </form> : <><div className="dialog-body"><p>Bid exactly <strong>{money(snapshot, me.balance)}</strong>, your entire remaining balance. If accepted, this bid is binding.</p></div><div className="dialog-footer"><button className="game-button" onClick={() => setPanel(null)}>Cancel</button><button className="game-button danger" disabled={cannotBid} onClick={() => { void act({ type: 'bid', amount: me.balance }); setPanel(null); }}>Confirm {money(snapshot, me.balance)}</button></div></>}
  </Modal>}</>;
}

function Invite({ code }: { code: string }) {
  const canvas = useRef<HTMLCanvasElement>(null); const [copied, setCopied] = useState(false);
  const link = `${location.origin}/room/${code}`;
  useEffect(() => { if (canvas.current) void QRCode.toCanvas(canvas.current, link, { width: 160, margin: 2, errorCorrectionLevel: 'M' }); }, [link]);
  return <div className="invite-panel"><canvas ref={canvas} role="img" aria-label={`Join room ${code} QR code`} /><label>Invite link<input readOnly value={link} onFocus={(event) => event.target.select()} /></label><button className="game-button" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? 'Copied' : 'Copy invite link'}</button><p>Select the link to copy manually if needed. Open it in each player’s own browser.</p></div>;
}

export function GameMenu({ snapshot, seat, locked, act, close }: { snapshot: RoomSnapshot; seat: RoomCredentials; locked: boolean; act: (action: Action) => Promise<void>; close: () => void }) {
  const host = snapshot.hostPlayerId === seat.playerId;
  const [view, setView] = useState<'menu' | 'invite' | 'display' | 'end' | 'resume' | 'recovery' | 'sitOut'>('menu');
  const [departed, setDeparted] = useState('');
  const [displayLink, setDisplayLink] = useState(''); const [error, setError] = useState('');
  const action = (value: Action) => { void act(value); close(); };
  async function display() {
    setView('display');
    try {
      const response = await serverRequest(`/api/rooms/${seat.code}/display`, { method: 'POST', headers: { Authorization: `Bearer ${seat.token}`, 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('Could not open the display. Try again.');
      const access = displayAuthSchema.parse(await response.json());
      setDisplayLink(`${location.origin}/display/${access.code}#access=${access.displayToken}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Display unavailable.'); }
  }
  return <Modal title={view === 'sitOut' ? 'Sit Out this player?' : view === 'recovery' ? 'Your private recovery code' : view === 'end' ? 'End this run?' : view === 'resume' ? 'Resume with players absent?' : view === 'invite' ? 'Invite friends' : view === 'display' ? 'Shared display' : 'Game menu'} close={close}>
    <div className="dialog-body">
      {view === 'menu' && <div className="menu-actions">
        <button className="game-button" onClick={() => setView('invite')}>Invite friends</button><button className="game-button" disabled={locked} onClick={() => void display()}>Open shared display</button>
        <button className="game-button" onClick={() => setView('recovery')}>Private recovery code</button><AppearanceButton />
        {snapshot.paused && <p>{snapshot.players.filter((player) => !player.connected && !player.sittingOut).map((player) => player.name).join(', ') || 'All participating players are connected.'}{snapshot.players.some((player) => !player.connected && !player.sittingOut) ? ' — absent. ' : ' '}Only the original host can Resume. If the host is absent, they must recover their own seat.</p>}
        {host && <><h3>Host controls</h3>
          {snapshot.paused && snapshot.players.filter((player) => !player.connected && !player.sittingOut && player.id !== snapshot.hostPlayerId).map((player) => <button className="game-button" key={player.id} disabled={locked} onClick={() => { setDeparted(player.id); setView('sitOut'); }}>Sit Out {player.name}</button>)}
          {snapshot.phase === 'lobby' && <button className="game-button bid-button" disabled={locked || snapshot.players.length < 2 || snapshot.players.some((player) => !player.connected)} onClick={() => action({ type: 'start' })}>Start game</button>}
          {['bidding', 'reveal'].includes(snapshot.phase) && (snapshot.paused ? <button className="game-button bid-button" disabled={locked} onClick={() => snapshot.players.some((player) => !player.connected) ? setView('resume') : action({ type: 'resume' })}>Resume game</button> : <button className="game-button" disabled={locked} onClick={() => action({ type: 'pause' })}>Pause game</button>)}
          {snapshot.phase === 'bidding' && <button className="game-button" disabled={locked || snapshot.paused || !!snapshot.current?.leader} onClick={() => action({ type: 'skip' })}>Skip unbid option</button>}
          {snapshot.phase === 'reveal' && <button className="game-button" disabled={locked || snapshot.paused} onClick={() => action({ type: 'next' })}>Next option</button>}
          {snapshot.phase !== 'finished' ? <button className="game-button danger" disabled={locked} onClick={() => setView('end')}>End game…</button> : <button className="game-button bid-button" disabled={locked} onClick={() => action({ type: 'playAgain' })}>Play again</button>}
        </>}
        <a className="game-button" href="/">Leave room</a><p>Leaving during play pauses the game. Your seat and purchases remain.</p>
      </div>}
      {view === 'invite' && <Invite code={snapshot.code} />}
      {view === 'recovery' && <RecoveryPanel seat={seat} locked={locked} />}
      {view === 'sitOut' && <p>Mark {playerName(snapshot, departed)} as permanently departed for this run? Purchases and any binding leading bid remain. They cannot place new bids or automatically buy later options. This is different from a temporary disconnect. Play Again restores participation. The game stays paused until you Resume.</p>}
      {view === 'display' && <><p>Open this read-only board on a second screen. It takes no seat and cannot place bids. Use Fullscreen, then your browser’s screen sharing or device mirroring.</p>{displayLink ? <><a className="game-button bid-button" href={displayLink} target="_blank" rel="noopener noreferrer">Launch shared display</a><label>Display link<input aria-label="Display link" readOnly value={displayLink} onFocus={(event) => event.target.select()} /></label><p>Anyone with this link can see public game information until the room expires. It contains no player credential.</p></> : <p role="status">{error || 'Preparing display…'}</p>}</>}
      {view === 'end' && <p>{snapshot.phase === 'bidding' && snapshot.current?.leader ? `${playerName(snapshot, snapshot.current.leader.playerId)} will pay their binding ${money(snapshot, snapshot.current.leader.amount)} bid. ` : ''}Later options will be unplayed and the result incomplete.</p>}
      {view === 'resume' && <><p>{snapshot.players.filter((player) => !player.connected && !player.sittingOut).map((player) => player.name).join(', ') || 'No participating player is absent'}: absent players retain their bids, purchases and eligibility. Absence is not Give Up.</p>{snapshot.players.some((player) => player.sittingOut) && <p>Sitting out: {snapshot.players.filter((player) => player.sittingOut).map((player) => player.name).join(', ')}. Existing bids still stand. Resume can settle a forced purchase.</p>}</>}
    </div>
    {(view === 'end' || view === 'resume') && <div className="dialog-footer"><button className="game-button" onClick={close}>Cancel</button><button className="game-button danger" disabled={locked} onClick={() => action(view === 'end' ? { type: 'end', confirmed: true } : { type: 'resume' })}>{view === 'end' ? 'Confirm End' : 'Confirm Resume'}</button></div>}
    {view === 'sitOut' && <div className="dialog-footer"><button className="game-button" onClick={close}>Cancel</button><button className="game-button danger" disabled={locked || snapshot.players.find((player) => player.id === departed)?.connected} onClick={() => action({ type: 'sitOut', playerId: departed, confirmed: true })}>Confirm Sit Out</button></div>}
  </Modal>;
}
