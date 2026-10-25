import { AppearanceButton } from '../appearance/Appearance.js';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import type { RoomCredentials, RoomSnapshot } from '../../../shared/rooms.js';
import type { Action } from './usePlayerRoom.js';
import { BidActions, GameMenu, money, playerName } from './Actions.js';
import { HistoryPanel, OptionPanel } from './PublicPanels.js';
import { BuildComparison, Collection } from './Collections.js';
import { Modal, PagedText, type MediaAccess } from './ui.js';
import './room.css';

const portraitQuery = '(max-width: 700px) and (orientation: portrait)';
function watchLayout(changed: () => void) {
  const query = window.matchMedia(portraitQuery); query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
}
const readLayout = () => window.matchMedia(portraitQuery).matches;

export function GameBoard({ snapshot, access, seat, connected, status, locked = false, act, connectionControls, message, pendingControls }: {
  snapshot: RoomSnapshot; access: MediaAccess; seat?: RoomCredentials; connected: boolean; status: string;
  locked?: boolean; act?: (action: Action) => Promise<void>; connectionControls?: ReactNode; message?: string; pendingControls?: ReactNode;
}) {
  const [information, setInformation] = useState<'details' | 'history' | null>(null);
  const [compare, setCompare] = useState(false); const [menu, setMenu] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false); const [fullscreenError, setFullscreenError] = useState('');
  const portrait = useSyncExternalStore(watchLayout, readLayout);
  const host = seat?.playerId === snapshot.hostPlayerId; const display = !!access.display; const finished = snapshot.phase === 'finished';
  const current = snapshot.current; const purchase = snapshot.purchases.find((item) => item.optionId === current?.option.id);
  const leader = snapshot.phase === 'bidding' ? current?.leader : purchase ? { playerId: purchase.playerId, amount: purchase.price } : null;
  const headline = snapshot.phase === 'lobby' ? 'Ready to build together' : finished ? snapshot.completion?.status === 'incomplete' ? 'Incomplete result' : 'Your finished builds' : snapshot.phase === 'reveal' ? purchase ? `${playerName(snapshot, purchase.playerId)} bought this for ${money(snapshot, purchase.price)}` : 'Unclaimed — no purchase' : current?.leader ? `${playerName(snapshot, current.leader.playerId)} leads at ${money(snapshot, current.leader.amount)}` : `Opening price ${money(snapshot, snapshot.settings.minimumOpeningBid)}`;
  const stateLabel = !connected ? 'Disconnected' : snapshot.paused ? `Paused${snapshot.pauseReason === 'disconnect' ? ' · player left' : snapshot.pauseReason === 'restart' ? ' · restart' : ''}` : snapshot.phase === 'lobby' ? 'Lobby' : finished ? 'Finished' : snapshot.phase === 'reveal' ? 'Revealing' : 'Live auction';
  const fullText = `${snapshot.title}\n\n${snapshot.description || 'No description.'}\n\nOpening price ${money(snapshot, snapshot.settings.minimumOpeningBid)}. Raise by at least ${money(snapshot, snapshot.settings.minimumBidIncrease)}. Give Up is sequential: the last eligible player can automatically buy at the opening price. Purchases always cost money.`;
  const ownPurchases = snapshot.purchases.filter((entry) => entry.playerId === seat?.playerId);
  const comparison = <BuildComparison snapshot={snapshot} access={access} ownId={seat?.playerId} />;
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { setFullscreenError('Fullscreen is unavailable here. Use your browser’s fullscreen or screen-sharing controls.'); }
  }
  return <div className={`game-board${display ? ' display-board' : ''}`} data-phase={snapshot.phase} data-layout={portrait ? 'portrait' : 'landscape'}>
    <header className="game-header"><a className="game-home" href="/" aria-label="Bid & Build home"><img src="/favicon.svg" alt="" width="28" height="28" /></a><button className="game-heading" aria-label="Read game description" onClick={() => setInformation('details')}><strong>{snapshot.title}</strong><span>Room {snapshot.code}{display ? ' · Shared display' : host ? ' · Host & player' : ' · Player'}</span></button>{(message || !connected || pendingControls) && <button className="status-details" onClick={() => setNoticeOpen(true)}>{!connected ? 'Reconnect' : pendingControls ? 'Check action' : 'Notice'}</button>}{display ? <><AppearanceButton /><button className="game-button" onClick={() => void fullscreen()}>Fullscreen</button></> : <button className="game-button" onClick={() => setMenu(true)}>Game menu</button>}</header>
    {!finished && portrait && <section className="balance-board" aria-label="All player balances">{snapshot.players.map((player) => <button className={`balance-card${player.id === seat?.playerId ? ' own-balance' : ''}`} key={player.id} onClick={() => setCompare(true)} aria-label={`${player.name}${player.id === seat?.playerId ? ', you' : ''}: ${money(snapshot, player.balance)}, ${player.sittingOut ? 'sitting out' : player.connected ? 'connected' : 'disconnected'}. Compare builds`}><span className="balance-name">{player.name}{player.id === seat?.playerId ? ' (you)' : ''}</span><strong className="balance-money"><span>{snapshot.settings.currencySymbol}</span><b>{player.balance.toLocaleString('en-US')}</b></strong><span className="balance-presence">{player.sittingOut ? 'Sitting out' : player.connected ? 'Connected' : 'Offline'}{player.id === snapshot.hostPlayerId ? ' · Host' : ''}</span></button>)}</section>}
    <section className="auction-status" aria-label="Current auction status"><div><button className={`game-state${snapshot.paused || !connected ? ' attention' : ''}`} title="View connection and absent players" onClick={() => setNoticeOpen(true)}>{stateLabel}</button><span className="option-counter">{current ? `${current.index + 1} / ${snapshot.optionCount}` : `${snapshot.optionCount} options`}</span></div><p className="high-bid" title={headline} aria-label={headline}>{leader && !finished ? <><span>{playerName(snapshot, leader.playerId)}</span><strong>{snapshot.phase === 'bidding' ? 'leads' : 'paid'} {money(snapshot, leader.amount)}</strong></> : headline}</p></section>
    {!finished && <section className="game-stage" aria-label="Current option"><div className="game-panel"><OptionPanel snapshot={snapshot} access={access} /></div><div className="board-tools"><button className="game-button" onClick={() => setInformation('history')}>History</button></div></section>}
    {(finished || !portrait || display) && <section className={`collections-area${finished ? ' results-area' : ''}`} aria-label={finished ? 'Final build comparison' : 'Player collections'}>
      <div className="collections-heading"><h2>{finished ? 'Compare everyone’s builds' : 'At the table'}</h2><span>{snapshot.purchases.length} acquired{!finished && ' · in seat order'}</span></div>
      <div className="comparison-scroll" tabIndex={0} role="region" aria-label="All builds">{comparison}</div>
    </section>}
    {!finished && portrait && seat && <section className="own-collection" aria-label="Your build"><header><h2>Your build <span>({ownPurchases.length})</span></h2><button className="game-button" onClick={() => setCompare(true)}>Compare builds</button></header><div className="collection-scroll" tabIndex={0} role="region" aria-label="Your acquired options">{ownPurchases.length ? <Collection snapshot={snapshot} access={access} entries={ownPurchases} /> : <p className="collection-empty">Your purchases will appear here.</p>}</div></section>}
    <section className="game-actions" aria-label={display ? 'Display status' : 'Your actions'}>
      {snapshot.phase === 'bidding' && seat && act ? <BidActions key={`${snapshot.runId}:${current?.auctionId}:${snapshot.phase}`} snapshot={snapshot} seat={seat} locked={locked} act={act} /> : <div className="phase-actions"><p>{!connected ? 'Reconnecting. The board may be out of date.' : snapshot.paused ? 'The host must Resume. Existing bids still stand.' : snapshot.phase === 'lobby' ? display ? 'Players join on their own devices.' : 'Start needs 2–5 connected players.' : snapshot.phase === 'reveal' ? 'Balances updated. Waiting for the next option.' : snapshot.phase === 'bidding' ? 'Read-only · players bid on their own devices.' : 'Compare your creations. No scored winner.'}</p>{snapshot.phase === 'lobby' && host && act && <button className="game-button bid-button" disabled={locked || snapshot.players.length < 2 || snapshot.players.some((player) => !player.connected)} onClick={() => void act({ type: 'start' })}>Start game</button>}{seat && !finished && snapshot.phase !== 'lobby' && <strong>Your balance {money(snapshot, snapshot.players.find((player) => player.id === seat.playerId)!.balance)}</strong>}{finished && <><button className="game-button" onClick={() => setInformation('history')}>History</button>{host && act && <button className="game-button" disabled={locked} onClick={() => void act({ type: 'playAgain' })}>Play again</button>}</>}</div>}
    </section>
    <span className="sr-only" role="status">{snapshot.phase === 'reveal' || finished ? headline : ''}</span>
    <span className="sr-only" role="status">{message}</span><span className="sr-only" role="status">{snapshot.players.filter((player) => player.sittingOut).map((player) => `${player.name} is sitting out this run. Purchases and binding bids remain.`).join(' ')}</span>
    {compare && <Modal title="Compare builds" className="comparison-dialog" closeLabel={finished ? 'Back to results' : 'Back to bidding'} close={() => setCompare(false)}><div className="comparison-current"><strong>{stateLabel} · {current ? `Option ${current.index + 1} / ${snapshot.optionCount}` : 'Lobby'}</strong><span>{current?.option.title ?? snapshot.title}</span><span>{headline}</span></div><div className="comparison-scroll" tabIndex={0} role="region" aria-label="All builds">{comparison}</div></Modal>}
    {information && <Modal title={information === 'history' ? 'Bid history' : 'Game details'} className="information-dialog" close={() => setInformation(null)}><div className="information-body">{information === 'details' ? <><PagedText text={fullText} /></> : <HistoryPanel snapshot={snapshot} />}</div></Modal>}
    {menu && seat && act && <GameMenu key={`${snapshot.runId}:${current?.auctionId}:${snapshot.phase}`} snapshot={snapshot} seat={seat} locked={locked} act={act} close={() => setMenu(false)} />}
    {(noticeOpen || fullscreenError) && <Modal title="Connection and messages" close={() => { setNoticeOpen(false); setFullscreenError(''); }}><div className="dialog-body"><p>{status}</p>{snapshot.paused && <p>The host must explicitly Resume. Reconnecting does not resume play.</p>}<p>Absent players: {snapshot.players.filter((player) => !player.connected && !player.sittingOut).map((player) => player.name).join(', ') || 'None'}. Temporary absence preserves eligibility and binding bids.</p>{!snapshot.players.find((player) => player.id === snapshot.hostPlayerId)?.connected && <p>The host is absent. Only recovery of the original host seat restores host controls.</p>}{message && <p role="alert">{message}</p>}{fullscreenError && <p>{fullscreenError}</p>}{connectionControls}{pendingControls}</div></Modal>}
  </div>;
}
