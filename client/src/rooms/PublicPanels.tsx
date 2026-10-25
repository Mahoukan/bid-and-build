import { useState } from 'react';
import type { RoomOption, RoomSnapshot } from '../../../shared/rooms.js';
import { money, playerName } from './Actions.js';
import { PagedText, Pager, RoomImage, type MediaAccess } from './ui.js';

export function OptionPanel({ snapshot, access, details }: { snapshot: RoomSnapshot; access: MediaAccess; details: (option?: RoomOption) => void }) {
  const lobby = snapshot.phase === 'lobby'; const option = snapshot.current?.option;
  return <div className="option-panel">
    <div className="option-art"><RoomImage assetId={lobby ? snapshot.coverAssetId : option?.imageAssetId ?? null} access={access} alt={lobby ? 'Game cover' : option?.title ?? 'Game'} /></div>
    <button className="option-title" onClick={() => details(option)} aria-label={`Read full details: ${lobby ? snapshot.title : option?.title ?? 'Game'}`}><h2>{lobby ? snapshot.title : option?.title ?? 'Ready to build'}</h2><span>Read full details ↗</span></button>
    {lobby && <p className="lobby-caption">{snapshot.players.length} / 5 seats · {snapshot.optionCount} options · Everyone starts with {money(snapshot, snapshot.settings.startingCurrency)}</p>}
    {!lobby && <p className="option-caption">{snapshot.phase === 'reveal' ? 'Purchase settled · next reveal is server controlled' : snapshot.phase === 'finished' ? 'Compare your builds — there is no scored winner' : 'Bid for what belongs in your build'}</p>}
  </div>;
}

export function HistoryPanel({ snapshot }: { snapshot: RoomSnapshot }) {
  const [page, setPage] = useState(0);
  // One full bid per page keeps maximum-length labels readable on small phones.
  const currentPage = Math.min(page, Math.max(0, snapshot.bids.length - 1));
  const bid = snapshot.bids[currentPage];
  return <div className="history-panel">
    {bid ? <PagedText key={`${currentPage}:${snapshot.runId}`} label="Detail" text={`${playerName(snapshot, bid.playerId)} bid ${money(snapshot, bid.amount)}\n\n${snapshot.revealedOptions.find((option) => option.id === bid.optionId)?.title ?? ''}`} /> : <p className="empty-state">No bids yet. Purchases appear in the collections.</p>}
    <Pager page={currentPage} count={snapshot.bids.length} onChange={setPage} label="Bid" />
  </div>;
}
