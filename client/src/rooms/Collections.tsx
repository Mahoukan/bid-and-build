import type { CSSProperties } from 'react';
import type { RoomSnapshot } from '../../../shared/rooms.js';
import { money } from './Actions.js';
import { RoomImage, type MediaAccess } from './ui.js';

type Props = { snapshot: RoomSnapshot; access: MediaAccess };
type Entry = { optionId: string; price?: number; status?: 'unclaimed' | 'unplayed' };

// Only authoritative, revealed options can be rendered. No template/draft data
// is available to this presentation, including in finished incomplete games.
export function Collection({ snapshot, access, entries }: Props & { entries: Entry[] }) {
  const options = new Map(snapshot.revealedOptions.map((option) => [option.id, option]));
  return <ul className="collection-list">{entries.map((entry) => {
    const option = options.get(entry.optionId); if (!option) return null;
    const recent = snapshot.phase === 'reveal' && entry.price !== undefined && option.id === snapshot.current?.option.id;
    return <li key={option.id}><article className={`collection-item${recent ? ' just-acquired' : ''}`} data-option-id={option.id}>
      <span className="collection-thumbnail"><RoomImage assetId={option.imageAssetId} access={access} alt="" /></span>
      <span className="collection-label"><strong>{option.title}</strong><span>{entry.price === undefined ? entry.status === 'unplayed' ? 'Unplayed' : 'Unclaimed' : money(snapshot, entry.price)}</span></span>
      <p className="collection-description">{option.description || 'No description.'}</p>
    </article></li>;
  })}</ul>;
}

export function BuildComparison({ snapshot, access, ownId }: Props & { ownId?: string }) {
  const hasWideCollection = snapshot.players.some((player) => snapshot.purchases.filter((entry) => entry.playerId === player.id).length > 6);
  return <div className="build-comparison" style={{ '--player-count': snapshot.players.length } as CSSProperties}>
    {snapshot.players.map((player, index) => {
      const entries = snapshot.purchases.filter((entry) => entry.playerId === player.id);
      return <section className={`player-collection${player.id === ownId ? ' own-build' : ''}`} key={player.id} data-player-id={player.id} data-wide={entries.length > 6 || !hasWideCollection && index === snapshot.players.length - 1 && snapshot.players.length % 2 === 1} aria-label={`${player.name}'s build`}>
        <header className="collection-heading"><h3>{player.name}{player.id === ownId && <span> · You</span>}</h3>
          <p className="collection-balance">Balance <strong>{money(snapshot, player.balance)}</strong></p>
          <p className="collection-totals">{entries.length} acquired · Spent {money(snapshot, snapshot.settings.startingCurrency - player.balance)}</p>
          {snapshot.phase !== 'finished' && <p className="collection-presence">{player.sittingOut ? 'Sitting out' : player.connected ? 'Connected' : 'Offline'}{player.id === snapshot.hostPlayerId ? ' · Host' : ''}</p>}
        </header>
        {entries.length ? <Collection snapshot={snapshot} access={access} entries={entries} /> : <p className="collection-empty">No purchases yet</p>}
      </section>;
    })}
    {(snapshot.unclaimed.length > 0 || snapshot.phase === 'finished' && snapshot.unrevealedCount > 0) && <section className="unclaimed-collection" aria-label="Unclaimed and unplayed options">
      <header className="collection-heading"><h3>Without an owner</h3><p>Unclaimed options were not bought. Unplayed options were left when the run ended early.</p></header>
      <Collection snapshot={snapshot} access={access} entries={snapshot.unclaimed} />
      {snapshot.phase === 'finished' && snapshot.unrevealedCount > 0 && <p className="hidden-options">{snapshot.unrevealedCount} unrevealed {snapshot.completion?.status === 'incomplete' ? 'unplayed' : 'unclaimed'} options. Their details stay hidden.</p>}
    </section>}
  </div>;
}
