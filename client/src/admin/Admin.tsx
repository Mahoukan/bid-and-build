import { useServerReady } from '../serverConnection.js';
import { useEffect, useRef, useState } from 'react';
import { Link, useBlocker } from 'react-router-dom';
import type { AdminSession, AdminTemplate, TemplateSummary } from '../../../shared/admin.js';
import { parseTemplateJson, templateSchema, TEMPLATE_LIMITS, type GameTemplate } from '../../../shared/template.js';
import { Field, TemplateFields } from '../builder/TemplateFields.js';
import { normalizeTemplateImages, processImage } from '../builder/images.js';
import { newTemplate } from '../builder/model.js';
import { AdminRequestError, adminRequest } from './api.js';
import './admin.css';

type Editor = { saved: AdminTemplate | null; template: GameTemplate; baseline: GameTemplate };
export default function Admin() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const ready = useServerReady();
  const [busy, setBusy] = useState(false);
  const locked = busy || !ready;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const dirty = !!editor && (editor.template !== editor.baseline || !editor.saved);
  const blocker = useBlocker(dirty || busy);
  useEffect(() => { if (blocker.state === 'blocked') leaveDialog.current?.showModal(); else leaveDialog.current?.close(); }, [blocker.state]);
  const csrf = session?.authenticated ? session.csrfToken : undefined;
  const validation = editor ? templateSchema.safeParse(editor.template) : null;
  const fieldError = (path: string) => showErrors && validation && !validation.success ? validation.error.issues.find((issue) => issue.path.join('.') === path)?.message : undefined;
  const fail = (reason: unknown) => {
    setError(reason instanceof Error ? reason.message : 'The request could not be completed.');
    if (reason instanceof AdminRequestError && (reason.status === 401 || reason.status === 403)) setSession({ authenticated: false });
  };
  useEffect(() => {
    let active = true;
    void adminRequest<AdminSession>('/api/admin/session').then((value) => { if (active) setSession(value); }).catch((reason: unknown) => { if (active) { setSession({ authenticated: false }); setError(reason instanceof Error ? reason.message : 'Sign-in unavailable.'); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    let active = true;
    void adminRequest<{ templates: TemplateSummary[] }>('/api/admin/templates').then((value) => { if (active) setTemplates(value.templates); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Collection unavailable.'); });
    return () => { active = false; };
  }, [session]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || busy) event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  const refresh = async () => setTemplates((await adminRequest<{ templates: TemplateSummary[] }>('/api/admin/templates')).templates);
  const choose = (value: AdminTemplate) => { setEditor({ saved: value, template: value.template, baseline: value.template }); setActiveIndex(0); setShowErrors(false); };
  const discard = () => !dirty || window.confirm('Discard unsaved template changes?');
  const run = async (action: () => Promise<void>) => {
    if (locked) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (reason) { fail(reason); } finally { setBusy(false); }
  };
  const save = () => void run(async () => {
    setShowErrors(true);
    if (!editor || !validation?.success) { setError('Check the marked fields. Every option needs a title.'); return; }
    const value = await adminRequest<AdminTemplate>(`/api/admin/templates${editor.saved ? `/${editor.saved.id}` : ''}`, editor.saved ? 'PUT' : 'POST', { template: validation.data, ...(editor.saved ? { revision: editor.saved.revision } : {}) }, csrf);
    choose(value); setNotice('Template saved. Active rooms keep their own copy.'); await refresh();
  });
  const upload = (file: File, cover: boolean) => void run(async () => {
    const image = await processImage(file);
    setEditor((current) => current ? { ...current, template: cover ? { ...current.template, coverImage: image } : { ...current.template, options: current.template.options.map((option, index) => index === activeIndex ? { ...option, image } : option) } } : current);
  });
  const saved = editor?.saved ?? null;
  return <div className="builder admin-page">
    <header className="page-heading"><p className="eyebrow">Administrator workspace</p><h1>Template collection</h1><p className="lede">Prepare permanent designs for everyone to play. Your admin account manages templates; in a game, you take an ordinary player seat.</p><Link className="text-button" to="/templates">Browse published templates</Link></header>
    {error && <p className="builder-error" role="alert">{error}</p>}
    {notice && <p className="builder-notice" role="status">{notice}</p>}
    {session === null ? <p role="status">Checking sign-in…</p> : !session.authenticated ? <section className="panel admin-login">
      <h2>Administrator sign-in</h2><p>Use the account created privately by the site owner. Guests can build and host without signing in.</p>
      {editor && <p>Unsaved editor contents are still in this tab. Sign in to continue editing.</p>}
      <form onSubmit={(event) => { event.preventDefault(); const secret = password; setPassword(''); void run(async () => { setSession(await adminRequest<AdminSession>('/api/admin/login', 'POST', { username, password: secret })); }); }}>
        <Field label="Admin username" id="admin-username"><input id="admin-username" autoComplete="username" value={username} maxLength={64} required disabled={locked} onChange={(event) => setUsername(event.target.value)} /></Field>
        <Field label="Password" id="admin-password"><input id="admin-password" type="password" autoComplete="current-password" value={password} maxLength={128} required disabled={locked} onChange={(event) => setPassword(event.target.value)} /></Field>
        <button className="button primary" disabled={locked}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </section> : <>
      <div className="builder-actions"><span>Signed in as <strong>{session.username}</strong></span><button className="button" disabled={locked} onClick={() => { if (discard()) void run(async () => { await adminRequest('/api/admin/logout', 'POST', {}, csrf); setSession({ authenticated: false }); setEditor(null); setTemplates([]); }); }}>Sign out</button></div>
      <section className="panel admin-library" aria-label="Saved templates"><div className="builder-actions"><h2>Saved templates</h2><button className="button primary" disabled={locked} onClick={() => { if (discard()) { const template = newTemplate(); setEditor({ saved: null, template, baseline: template }); setActiveIndex(0); setShowErrors(false); setError(''); setNotice(''); } }}>New template</button><button className="button" disabled={locked} onClick={() => void run(refresh)}>Refresh list</button></div>
        {templates.length === 0 && <p>No permanent templates yet. Create one, then publish it when ready.</p>}
        <ul className="admin-template-list">{templates.map((item) => <li key={item.id}><button disabled={locked} aria-current={saved?.id === item.id ? 'true' : undefined} onClick={() => { if (discard()) void run(async () => choose(await adminRequest<AdminTemplate>(`/api/admin/templates/${item.id}`))); }}><strong>{item.title}</strong><span>{item.published ? 'Published' : 'Unpublished'} · {item.optionCount} options · revision {item.revision}</span></button></li>)}</ul>
      </section>
      {editor && <section aria-label="Template editor">
        <div className="builder-actions admin-editor-heading"><h2>{saved ? 'Edit template' : 'New template'}</h2><span className="tag">{saved?.published ? 'Published' : 'Unpublished'}{dirty ? ' · Unsaved changes' : ''}</span></div>
        <p className="small-note">Saving a published template updates the catalogue. Rooms already hosted retain their original content and images.</p>
        <div className="builder-actions"><button className="button primary" disabled={locked} onClick={save}>{busy ? 'Working…' : 'Save template'}</button>
          <button className="button" disabled={locked} onClick={() => importRef.current?.click()}>Import template JSON</button>
          <input hidden ref={importRef} type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file && discard()) void run(async () => { if (file.size > TEMPLATE_LIMITS.jsonBytes) throw new Error('Template file is too large.'); const template = await normalizeTemplateImages(parseTemplateJson(await file.text())); setEditor({ saved, template, baseline: editor.baseline }); setActiveIndex(0); }); }} />
          {saved && <><button className="button" disabled={locked || dirty} onClick={() => void run(async () => { choose(await adminRequest<AdminTemplate>(`/api/admin/templates/${saved.id}/publication`, 'POST', { revision: saved.revision, published: !saved.published }, csrf)); await refresh(); setNotice(saved.published ? 'Template unpublished.' : 'Template published. Guests can now host it.'); })}>{saved.published ? 'Unpublish' : 'Publish'}</button>
            <button className="button" disabled={locked || dirty} onClick={() => void run(async () => { choose(await adminRequest<AdminTemplate>(`/api/admin/templates/${saved.id}/duplicate`, 'POST', { revision: saved.revision }, csrf)); await refresh(); setNotice('Unpublished copy created.'); })}>Duplicate template</button>
            <button className="button danger" disabled={locked} onClick={() => { if (window.confirm(`Permanently delete “${saved.template.title}”? This also discards unsaved edits. Existing rooms keep their copy.`)) void run(async () => { await adminRequest(`/api/admin/templates/${saved.id}`, 'DELETE', { confirmed: true, revision: saved.revision }, csrf); setEditor(null); await refresh(); setNotice('Template deleted. Existing rooms are unchanged.'); }); }}>Delete template</button>
            <button className="button" disabled={locked} onClick={() => { if (discard()) void run(async () => choose(await adminRequest<AdminTemplate>(`/api/admin/templates/${saved.id}`))); }}>Reload saved template</button></>}
        </div>
        {dirty && saved && <p className="small-note">Save your changes before publishing or duplicating.</p>}
        <TemplateFields template={editor.template} update={(template) => setEditor({ ...editor, template })} activeIndex={activeIndex} setActiveIndex={setActiveIndex} busy={busy} upload={upload} fieldError={fieldError} />
        <button className="button primary" disabled={locked} onClick={save}>Save template</button>
      </section>}
    </>}
    <dialog ref={leaveDialog} className="panel admin-leave" aria-label="Unsaved template" onCancel={(event) => { event.preventDefault(); if (blocker.state === 'blocked') blocker.reset(); }}>{blocker.state === 'blocked' && <><h2>Leave this editor?</h2><p>Unsaved changes will be lost. Wait for any pending request to finish first.</p><div className="builder-actions"><button className="button primary" autoFocus onClick={() => blocker.reset()}>Keep editing</button><button className="button" disabled={busy} onClick={() => blocker.proceed()}>Discard and leave</button></div></>}</dialog>
  </div>;
}
