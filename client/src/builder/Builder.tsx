import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import dragon from '../../../samples/dragon-game.json';
import { exportTemplate, imageSource, parseTemplateJson, templateSchema, TEMPLATE_LIMITS, type GameTemplate } from '../../../shared/template.js';
import { deleteDraft, draftNameSchema, listDrafts, loadDraft, saveDraft, storageMessage, type DraftRecord, type DraftSummary } from './drafts.js';
import { normalizeTemplateImages, processImage } from './images.js';
import { newLocalId, newTemplate } from './model.js';
import './builder.css';
import { Field, TemplateFields } from './TemplateFields.js';
import { hostRoom } from '../rooms/api.js';
import '../rooms/room.css';

type Editor = { name: string; template: GameTemplate };
type Session = { editor: Editor; baseline: Editor; id: string | null; revision: number | null };
function sessionFor(template: GameTemplate, name: string, record?: DraftRecord): Session {
  const editor = { name, template };
  return { editor, baseline: editor, id: record?.id ?? null, revision: record?.revision ?? null };
}
function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.slice(0, 3).map((issue) => `${issue.path.join('.') || 'Template'}: ${issue.message}`).join(' ');
  return storageMessage(error);
}
export default function Builder() {
  const navigate = useNavigate();
  const hostDialog = useRef<HTMLDialogElement>(null);
  const leavingToRoom = useRef(false);
  const [playerName, setPlayerName] = useState('');
  const [session, setSession] = useState(() => sessionFor(newTemplate(), 'Untitled draft'));
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [libraryId, setLibraryId] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const { editor } = session;
  const { template } = editor;
  const option = template.options[activeIndex];
  const dirty = editor !== session.baseline;
  const validation = useMemo(() => templateSchema.safeParse(template), [template]);
  const nameValidation = draftNameSchema.safeParse(editor.name);
  const blocker = useBlocker(() => !leavingToRoom.current && (dirty || busy));

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([listDrafts(), loadDraft()]).then(([list, last]) => {
      if (cancelled) return;
      if (list.status === 'fulfilled') setDrafts(list.value);
      if (last.status === 'fulfilled' && last.value) {
        const row = last.value;
        setSession(sessionFor(row.template, row.name, row)); setLibraryId(row.id);
      }
      const failed = [list, last].find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') setError(`Local drafts could not be loaded. ${errorMessage(failed.reason)} You can still edit and export.`);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (!busy && window.confirm('Leave the builder and discard unsaved changes? Save or export first to keep them.')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker, busy]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);

  function update(next: GameTemplate) {
    setSession((current) => ({ ...current, editor: { ...current.editor, template: next } }));
    setNotice('');
  }
  function fieldError(path: string): string | undefined {
    if (!showErrors || validation.success) return undefined;
    return validation.error.issues.find((issue) => issue.path.join('.') === path)?.message;
  }
  function canReplace() { return !dirty || window.confirm('Discard unsaved changes? Save or export first to keep them.'); }
  function replace(next: Session, message = '') {
    setSession(next); setActiveIndex(0); setShowErrors(false); setError(''); setNotice(message);
  }
  async function run(operation: () => Promise<void>) {
    if (busy || loading) return;
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  function validTemplate(): GameTemplate | null {
    setShowErrors(true);
    if (!validation.success) {
      setError('Fix the highlighted fields before saving or exporting.');
      const index = validation.error.issues.find((issue) => issue.path[0] === 'options' && typeof issue.path[1] === 'number')?.path[1];
      if (typeof index === 'number') setActiveIndex(index);
      return null;
    }
    return validation.data;
  }
  function save(copy = false) {
    const value = validTemplate();
    if (!value || !nameValidation.success) { setShowErrors(true); return; }
    void run(async () => {
      let row: DraftRecord;
      try {
        row = await saveDraft({ id: copy || !session.id ? newLocalId() : session.id, name: copy ? `${nameValidation.data.slice(0, 113)} (copy)` : nameValidation.data, template: value }, copy ? null : session.revision);
      } catch (cause) {
        // A failed write may mean the previously loaded revision was deleted
        // or replaced elsewhere. Keep the editor protected and visibly unsaved.
        setSession((current) => ({ ...current, baseline: { ...current.baseline } }));
        throw cause;
      }
      const { template: savedTemplate, ...summary } = row;
      setDrafts((current) => [summary, ...current.filter((item) => item.id !== row.id)]);
      setLibraryId(row.id); setSession(sessionFor(savedTemplate, row.name, row));
      setNotice(copy ? 'Copy saved to this browser.' : 'Saved to this browser.');
    });
  }
  function exportFile() {
    const value = validTemplate();
    if (!value) return;
    try {
      const blob = new Blob([exportTemplate(value)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `${value.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 70) || 'bid-and-build'}.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError(''); setNotice('Export prepared. Keep the downloaded JSON file as your backup.');
    } catch (cause) { setError(errorMessage(cause)); }
  }
  function upload(file: File, cover: boolean) {
    void run(async () => {
      const image = await processImage(file);
      const next = cover ? { ...template, coverImage: image } : { ...template, options: template.options.map((item, index) => index === activeIndex ? { ...item, image } : item) };
      // Incomplete text is allowed during editing; reject an oversized image
      // collection without replacing any existing image or text.
      const parsed = templateSchema.safeParse(next);
      if (!parsed.success && parsed.error.issues.some((issue) => issue.message.startsWith('All images together'))) throw new Error('All images together must be 8 MiB or smaller. Remove an image before adding another.');
      update(next); setNotice('Image processed locally. Save to keep this change.');
    });
  }
  function importFile(file: File) {
    if (!canReplace()) return;
    void run(async () => {
      if (file.size > TEMPLATE_LIMITS.jsonBytes) throw new Error('Template JSON must be 12 MiB or smaller.');
      const next = await normalizeTemplateImages(parseTemplateJson(await file.text()));
      replace(sessionFor(next, next.title));
      // Imported and starter templates need an explicit Save even before edits.
      setSession((current) => ({ ...current, baseline: { ...current.editor } }));
      setLibraryId(''); setNotice('Imported locally. Save to keep it in this browser.');
    });
  }
  const selectedDraft = drafts.find((item) => item.id === libraryId);

  return <div className="builder">
    <div className="page-heading"><p className="eyebrow">Your idea, your game</p><h1>The workshop</h1><p className="lede">Make a collection of possibilities. Save it here, or take it with you.</p></div>
    <section className="panel draft-library" aria-labelledby="library-heading">
      <h2 id="library-heading">Your local drafts</h2><p className="small-note">Drafts stay in this browser, on this website address. Export a backup to move them to another browser or device.</p>
      <fieldset disabled={busy || loading}>
        <div className="builder-actions">
          <button className="button" onClick={() => { if (canReplace()) { replace(sessionFor(newTemplate(), 'Untitled draft')); setLibraryId(''); } }}>New draft</button>
          <button className="button" onClick={() => { if (canReplace()) { const starter = templateSchema.parse(dragon); const next = sessionFor(starter, starter.title); replace({ ...next, baseline: { ...next.editor } }, 'Dragon starter loaded. Save to keep your own copy.'); setLibraryId(''); } }}>Use dragon starter</button>
          <button className="button" onClick={() => importRef.current?.click()}>Import JSON</button>
          <input ref={importRef} className="visually-hidden" tabIndex={-1} aria-label="Import template JSON" type="file" accept=".json,application/json" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) importFile(file); }} />
        </div>
        <div className="library-picker"><Field label="Saved drafts" id="saved-drafts"><select id="saved-drafts" value={libraryId} onChange={(event) => setLibraryId(event.target.value)}><option value="">{drafts.length ? 'Choose a saved draft' : 'No saved drafts yet'}</option>{drafts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
          <div className="builder-actions">
            <button className="button" disabled={!selectedDraft} onClick={() => { if (canReplace()) void run(async () => { const row = await loadDraft(libraryId); if (!row) throw new Error('This draft was deleted in another tab. Refresh the draft list.'); replace(sessionFor(row.template, row.name, row)); }); }}>Load draft</button>
            <button className="button danger" disabled={!selectedDraft} onClick={() => { if (selectedDraft && window.confirm(`Delete “${selectedDraft.name}” from this browser? This cannot be undone. Your open editor will be kept.`)) void run(async () => { await deleteDraft(selectedDraft.id, selectedDraft.revision); setDrafts((current) => current.filter((item) => item.id !== selectedDraft.id)); setLibraryId(''); if (session.id === selectedDraft.id) setSession((current) => ({ ...current, id: null, revision: null, baseline: { ...current.editor } })); setNotice('Draft deleted. The open editor has been kept.'); }); }}>Delete draft</button>
            <button className="text-button" onClick={() => void run(async () => setDrafts(await listDrafts()))}>Refresh list</button>
          </div>
        </div>
      </fieldset>
    </section>
    <div className="save-bar">
      <p role="status" aria-live="polite" data-save-state={dirty ? 'unsaved' : session.id ? 'saved' : 'new'}>{loading ? 'Loading local drafts…' : busy ? 'Working locally…' : dirty ? 'Unsaved changes' : session.id ? 'Saved to this browser' : 'Not saved yet'}</p>
      <div className="builder-actions"><button className="button primary" disabled={busy || loading} onClick={() => save()}>Save draft</button><button className="button" disabled={busy || loading} onClick={() => save(true)}>Save as copy</button><button className="button" disabled={busy || loading} onClick={exportFile}>Export JSON</button></div>
    </div>
    {error && <p className="builder-error" role="alert">{error}</p>}
    {notice && <p className="builder-notice" role="status">{notice}</p>}
    <div className="editor-layout">
      <TemplateFields template={template} update={update} activeIndex={activeIndex} setActiveIndex={setActiveIndex} busy={busy} loading={loading} upload={upload} fieldError={fieldError} draftName={<Field label="Draft name (only in this browser)" id="draft-name" error={showErrors && !nameValidation.success ? nameValidation.error.issues[0]?.message : undefined}><input id="draft-name" maxLength={120} value={editor.name} aria-invalid={showErrors && !nameValidation.success} aria-describedby={showErrors && !nameValidation.success ? 'draft-name-error' : undefined} onChange={(event) => { setSession({ ...session, editor: { ...editor, name: event.target.value } }); setNotice(''); }} /></Field>} />
      <aside className="preview-column" aria-label="Live preview"><div className="panel card-preview"><p className="eyebrow">Live card preview · option {option ? activeIndex + 1 : '—'}</p><div className="preview-image">{option?.image ? <img src={imageSource(option.image)} alt={option.title || 'Option preview'} /> : <span>Room for your imagination</span>}</div><h2>{option?.title || 'Your next possibility'}</h2><p className="preview-description">{option?.description || 'No description.'}</p><p className="preview-price">Opening price <strong>{template.currencySymbol}{Number.isFinite(template.minimumOpeningBid) ? template.minimumOpeningBid : '—'}</strong></p></div>
        <div className="panel theme-preview">{template.coverImage && <img src={imageSource(template.coverImage)} alt="Game cover preview" />}<p className="eyebrow">Your game</p><h2>{template.title || 'Untitled game'}</h2><p className="preview-description">{template.description}</p><p className="small-note">{template.options.length} options · 2–5 players including the host</p><button className="button primary" disabled={busy || loading} onClick={() => { if (validTemplate()) { setError(''); hostDialog.current?.showModal(); } }}>Host game</button><p className="small-note">Share a temporary game copy and take the first player seat.</p></div>
      </aside>
    </div>
    <dialog className="host-dialog" ref={hostDialog} onCancel={(event) => { if (busy) event.preventDefault(); }} aria-labelledby="host-heading"><h2 id="host-heading">Host and play</h2><p>Only this game and its content images will be sent to the server. Save your draft first if you want to keep your latest edits in the workshop.</p><form onSubmit={(event) => { event.preventDefault(); const value = validTemplate(); if (value) void run(async () => { const seat = await hostRoom(value, playerName); leavingToRoom.current = true; navigate(`/room/${seat.code}`); }); }}><label>Your player name<input autoFocus required maxLength={40} value={playerName} disabled={busy} onChange={(event) => setPlayerName(event.target.value)} /></label>{error && <p className="builder-error" role="alert">{error}</p>}<div className="room-actions"><button className="button primary" disabled={busy || !playerName.trim()}>{busy ? 'Creating room…' : 'Create room & play'}</button><button type="button" className="button" disabled={busy} onClick={() => hostDialog.current?.close()}>Cancel</button></div></form></dialog>
  </div>;
}
