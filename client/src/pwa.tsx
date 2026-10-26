import { useEffect, useState } from 'react';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installPrompt: InstallEvent | null = null;
let registration: ServiceWorkerRegistration | undefined;
const changed = () => window.dispatchEvent(new Event('pwa-status'));

export function startPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); installPrompt = event as InstallEvent; changed();
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; changed(); });
  void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then((value) => {
    registration = value;
    changed();
    const watchInstalling = () => value.installing?.addEventListener('statechange', changed);
    watchInstalling();
    value.addEventListener('updatefound', watchInstalling);
    let checked = 0;
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - checked < 60_000) return;
      checked = Date.now(); void value.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    window.setInterval(check, 60 * 60_000);
    check();
  }).catch(() => { /* Browser access remains usable when installation is unavailable. */ });
}

function installed() {
  return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function AppInstallation() {
  const [, render] = useState(0);
  const [instructions, setInstructions] = useState(false);
  const [later, setLater] = useState(false);
  const [nextLaunch, setNextLaunch] = useState(false);
  useEffect(() => {
    const update = () => render((value) => value + 1);
    const mode = window.matchMedia('(display-mode: standalone)');
    window.addEventListener('pwa-status', update); mode.addEventListener('change', update);
    return () => { window.removeEventListener('pwa-status', update); mode.removeEventListener('change', update); };
  }, []);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const safari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
  const canInstall = import.meta.env.PROD && window.isSecureContext && !installed() && (installPrompt || ios && safari);
  const waiting = !!registration?.waiting;
  async function install() {
    if (!installPrompt) { setInstructions(true); return; }
    const event = installPrompt; installPrompt = null; changed();
    try { await event.prompt(); await event.userChoice; } catch { /* A dismissed or expired native prompt can be offered by the browser later. */ }
  }
  if (!canInstall && (!waiting || later)) return null;
  return <aside className="app-installation" aria-label="App installation and updates">
    {canInstall && <><button className="text-button" onClick={() => void install()}>Install app</button>{instructions && <p>In Safari, tap Share → Add to Home Screen, then Add. Enable Open as Web App if offered. <button className="text-button" onClick={() => setInstructions(false)}>Dismiss</button></p>}</>}
    {waiting && !later && <div><p>{nextLaunch ? 'Update ready for your next launch. Save your work, then close all Bid and Build tabs and app windows before reopening.' : 'An app update is ready. Your open games and edits will keep running.'}</p><div className="app-installation-actions">{!nextLaunch && <button className="text-button" onClick={() => setNextLaunch(true)}>Update next launch</button>}<button className="text-button" onClick={() => setLater(true)}>Later</button></div></div>}
  </aside>;
}
