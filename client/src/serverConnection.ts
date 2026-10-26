import { useSyncExternalStore } from 'react';
import { healthSchema } from '../../shared/health.js';

let ready = false;
let checking: Promise<void> | undefined;
let generation = 0;
const listeners = new Set<() => void>();
function publish(value: boolean) {
  if (ready === value) return;
  ready = value; for (const listener of listeners) listener();
}
export function serverUnavailable() { generation++; publish(false); }
export function checkServer() {
  if (checking) return checking;
  const attempt = generation;
  checking = (async () => {
    try {
      const response = await fetch('/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const valid = response.ok && healthSchema.safeParse(await response.json()).success;
      if (attempt === generation) publish(valid);
    } catch { if (attempt === generation) publish(false); }
    finally { checking = undefined; }
  })();
  return checking;
}
export function startServerMonitor() {
  void checkServer();
  window.addEventListener('offline', serverUnavailable);
  window.addEventListener('online', () => void checkServer());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkServer(); });
  window.setInterval(() => { if (document.visibilityState === 'visible') void checkServer(); }, 10_000);
}
export function useServerReady() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => ready);
}
export async function serverRequest(input: string, init?: RequestInit) {
  if (init?.method && !['GET', 'HEAD'].includes(init.method) && !ready) throw new Error('Connection unavailable. Wait for the server to reconnect before trying again.');
  try {
    const response = await fetch(input, { ...init, cache: 'no-store' });
    if (response.status >= 500) serverUnavailable();
    return response;
  } catch (error) { serverUnavailable(); throw error; }
}
