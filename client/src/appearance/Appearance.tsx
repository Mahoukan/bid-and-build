import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { decodeBase64 } from '../../../shared/raster.js';
import { processImage } from '../builder/images.js';
import { Modal } from '../rooms/ui.js';
import { applyAppearance, presets, type Appearance } from './model.js';
import { APPEARANCE_KEY, readBackground, readSettings, resetAppearance, saveAppearance, storageError, type SavedAppearance } from './storage.js';
import '../rooms/room.css';
import './appearance.css';

const AppearanceContext = createContext<(() => void) | null>(null);
export function AppearanceButton({ className = 'game-button' }: { className?: string }) {
  const open = useContext(AppearanceContext);
  return <button type="button" className={className} onClick={() => open?.()}>Appearance</button>;
}
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(readSettings);
  const [saved, setSaved] = useState<SavedAppearance>({ preferences: initial.preferences, serialized: initial.serialized, background: null });
  const [preview, setPreview] = useState<SavedAppearance | null>(null);
  const [error, setError] = useState(initial.error);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true, generation = 0;
    const restore = async () => {
      const turn = ++generation; const stored = readSettings(); setLoading(true);
      let background: Blob | null = null; let problem = stored.error;
      try { background = await readBackground(stored.preferences.backgroundId); } catch (reason) { problem = storageError(reason); }
      if (!active || generation !== turn) return;
      setSaved({ preferences: stored.preferences, serialized: stored.serialized, background }); setError(problem); setLoading(false); setInitialized(true);
    };
    void restore(); const changed = (event: StorageEvent) => { if (event.key === APPEARANCE_KEY || event.key === null) void restore(); };
    window.addEventListener('storage', changed); return () => { active = false; window.removeEventListener('storage', changed); };
  }, []);
  const shown = preview ?? saved;
  useLayoutEffect(() => { applyAppearance(shown.preferences); }, [shown.preferences]);
  useEffect(() => {
    const url = shown.background ? URL.createObjectURL(shown.background) : null;
    document.documentElement.style.setProperty('--personal-background', url ? `url("${url}")` : 'none');
    document.documentElement.dataset.background = String(!!url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [shown.background]);
  const close = () => { setOpen(false); setPreview(null); };
  return <AppearanceContext value={() => setOpen(true)}>{children}{open && (initialized ? <AppearancePanel saved={saved} loading={loading} loadError={error} preview={setPreview} close={close} committed={(value) => { setSaved(value); setPreview(null); setError(''); }} /> : <Modal title="Appearance" close={close}><p className="dialog-body" role="status">Loading saved appearance…</p></Modal>)}</AppearanceContext>;
}
function AppearancePanel({ saved, loading, loadError, preview, committed, close }: {
  saved: SavedAppearance; loading: boolean; loadError: string;
  preview: (value: SavedAppearance) => void; committed: (value: SavedAppearance) => void; close: () => void;
}) {
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [accentText, setAccentText] = useState(saved.preferences.accent);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const dirty = JSON.stringify(draft.preferences) !== JSON.stringify(saved.preferences) || draft.background !== saved.background || accentText !== draft.preferences.accent;
  const update = (preferences: Appearance, background = draft.background) => {
    const value = { ...draft, preferences, background }; setDraft(value); preview(value); setError(''); setNotice('');
  };
  const change = (fields: Partial<Appearance>) => update({ ...draft.preferences, ...fields });
  const run = async (action: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (reason) { if (alive.current) setError(storageError(reason)); } finally { if (alive.current) setBusy(false); }
  };
  const finish = (value: SavedAppearance) => { committed(value); setDraft(value); setAccentText(value.preferences.accent); };
  const leave = () => { if (!busy) close(); };
  return <Modal title="Appearance" close={leave} closeDisabled={busy}>
    <div className="dialog-body appearance-body">
      <p>Make this browser yours. Your choices stay here, including on a shared display opened in this browser.</p>
      {(error || loadError) && <p className="builder-error" role="alert">{error || loadError}</p>}
      <p className="appearance-status" role="status">{busy ? 'Working…' : notice || (loading ? 'Loading saved appearance…' : loadError ? 'Using a fallback · saved data needs attention' : dirty ? 'Preview only · not saved yet' : saved.serialized ? 'Saved appearance · this browser only' : 'Default appearance · this browser only')}</p>
      <fieldset disabled={busy || loading} className="appearance-controls"><legend>Style</legend>
        <div className="preset-choices">{(Object.keys(presets) as Appearance['preset'][]).map((preset) => <button type="button" className="game-button" aria-pressed={draft.preferences.preset === preset} key={preset} onClick={() => { const next = { ...draft.preferences, ...presets[preset], preset }; update(next); setAccentText(next.accent); }}>{preset}</button>)}</div>
        <div className="appearance-row"><label htmlFor="appearance-mode">Colour mode<select id="appearance-mode" value={draft.preferences.mode} onChange={(event) => change({ mode: event.target.value as Appearance['mode'] })}><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <label htmlFor="appearance-colour">Accent colour<input id="appearance-colour" type="color" value={draft.preferences.accent} onChange={(event) => { change({ accent: event.target.value }); setAccentText(event.target.value); }} /></label></div>
        <label htmlFor="appearance-hex">Accent hex<input id="appearance-hex" autoComplete="off" spellCheck={false} maxLength={7} value={accentText} aria-invalid={!/^#[a-fA-F0-9]{6}$/.test(accentText)} onChange={(event) => { setAccentText(event.target.value); if (/^#[a-fA-F0-9]{6}$/.test(event.target.value)) change({ accent: event.target.value }); }} /></label>
        <p className="small-note">Very light or dark accents are adjusted on controls to keep text readable.</p>
        <label className="appearance-check"><input type="checkbox" checked={draft.preferences.glass} onChange={(event) => change({ glass: event.target.checked })} />Glassy surfaces</label>
        <p className="small-note">Glass uses a solid surface when transparency is reduced or blur is unavailable.</p>
        <label htmlFor="personal-background">Local background image<input id="personal-background" type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(async () => { const result = await processImage(file); if (alive.current) update(draft.preferences, new Blob([decodeBase64(result.data)], { type: 'image/png' })); }); }} /></label>
        <p className="small-note">PNG or JPEG, up to 5 MiB / 20 MP. Resized locally; never uploaded. A soft overlay keeps game text clear.</p>
        {(draft.background || draft.preferences.backgroundId) && <button className="game-button" onClick={() => update({ ...draft.preferences, backgroundId: null }, null)}>Remove background</button>}
      </fieldset>
      <section className="appearance-preview" aria-label="Appearance preview"><p className="small-note">Appearance preview</p><div className="appearance-sample"><strong>Example option</strong><span>Your balance $20</span><span className="appearance-sample-bid">Bid $1</span></div>{draft.background && <><div className="personal-background-preview" role="img" aria-label="Selected local background" /><p className="small-note">Your image, before the readability overlay.</p></>}</section>
    </div>
    <footer className="dialog-footer appearance-footer"><button className="game-button" disabled={busy || loading} onClick={() => void run(async () => { const result = await resetAppearance(saved); finish(result.saved); setNotice(result.cleanupFailed ? 'Defaults saved. The browser could not remove some unused background bytes.' : 'Defaults saved to this browser. Drafts and player identity retained.'); })}>Reset to Defaults</button><button className="game-button bid-button" disabled={busy || loading || !/^#[a-fA-F0-9]{6}$/.test(accentText)} onClick={() => void run(async () => { finish(await saveAppearance(draft.preferences, draft.background, { ...saved, serialized: draft.serialized })); setNotice('Saved to this browser.'); })}>Save appearance</button></footer>
  </Modal>;
}
