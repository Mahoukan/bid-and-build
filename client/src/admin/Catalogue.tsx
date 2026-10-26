import { useServerReady } from '../serverConnection.js';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CatalogueTemplate } from '../../../shared/admin.js';
import { hostPublishedTemplate } from '../rooms/api.js';
import { Field } from '../builder/TemplateFields.js';
import { adminRequest } from './api.js';
import './admin.css';

export default function Catalogue() {
  const ready = useServerReady();
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{ templates: CatalogueTemplate[]; hasMore: boolean } | null>(null);
  const [error, setError] = useState('');
  const [hostError, setHostError] = useState('');
  const [selected, setSelected] = useState<CatalogueTemplate | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    void adminRequest<{ templates: CatalogueTemplate[]; hasMore: boolean }>(`/api/templates?page=${page}`).then((value) => { if (active) setData(value); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Catalogue unavailable.'); });
    return () => { active = false; };
  }, [page, attempt]);
  useEffect(() => { if (selected) dialog.current?.showModal(); }, [selected]);
  const turnPage = (next: number) => { setData(null); setError(''); setPage(next); };
  return <div className="builder catalogue-page"><header className="page-heading"><p className="eyebrow">Ready for your table</p><h1>Choose a build</h1><p className="lede">Pick a published design and invite 1–4 friends. You’ll take the host’s player seat. No account needed.</p><Link className="text-button" to="/builder">Or make your own in the builder</Link></header>
    {error ? <p role="alert">{error} <button className="button" onClick={() => { setError(''); setAttempt(attempt + 1); }}>Retry</button></p> : !data ? <p role="status">Loading templates…</p> : <>
      {data.templates.length === 0 && <section className="panel admin-library"><h2>No published templates here yet</h2><p>You can still create a local design and host it from the builder.</p></section>}
      <div className="catalogue-grid">{data.templates.map((item) => <article key={item.id} className="panel catalogue-card">{item.coverUrl && <img src={item.coverUrl} alt="" loading="lazy" />}<div><span className="tag">{item.optionCount} options</span><h2>{item.title}</h2><p className="catalogue-description">{item.description}</p><button className="button primary" disabled={!ready} onClick={() => { setHostError(''); setSelected(item); }}>Host {item.title}</button></div></article>)}</div>
      <div className="builder-actions"><button className="button" disabled={page === 0} onClick={() => turnPage(page - 1)}>Previous page</button><span>Page {page + 1}</span><button className="button" disabled={!data.hasMore} onClick={() => turnPage(page + 1)}>Next page</button></div>
    </>}
    <dialog className="catalogue-dialog" ref={dialog} aria-labelledby="catalogue-host-title" onCancel={(event) => { if (busy) event.preventDefault(); }} onClose={() => setSelected(null)}>
      <h2 id="catalogue-host-title">Host {selected?.title}</h2><p>The options will appear one at a time during play. Invite your friends after creating the room.</p>
      {hostError && <p role="alert">{hostError}</p>}
      <form onSubmit={(event) => { event.preventDefault(); if (!selected || busy) return; setBusy(true); setHostError(''); void hostPublishedTemplate(selected.id, name).then((seat) => navigate(`/room/${seat.code}`)).catch((reason: unknown) => setHostError(reason instanceof Error ? reason.message : 'Hosting failed.')).finally(() => setBusy(false)); }}>
        <Field label="Your player name" id="catalogue-player"><input id="catalogue-player" value={name} maxLength={32} required disabled={busy} onChange={(event) => setName(event.target.value)} /></Field><div className="builder-actions"><button className="button primary" disabled={busy || !ready || !name.trim()}>{busy ? 'Creating room…' : 'Create room'}</button><button className="button" type="button" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button></div>
      </form>
    </dialog>
  </div>;
}
