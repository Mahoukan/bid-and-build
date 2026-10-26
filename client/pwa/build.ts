import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

export function pwaBuild(): Plugin {
  return {
    name: 'bid-build-pwa', apply: 'build',
    generateBundle(_options, bundle) {
      const offline = readFileSync(new URL('./offline.html', import.meta.url), 'utf8');
      const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);
      const offlineUrl = `/assets/offline-${digest(offline)}.html`;
      this.emitFile({ type: 'asset', fileName: offlineUrl.slice(1), source: offline });
      const assets = [...Object.keys(bundle).filter((name) => name.startsWith('assets/') && !name.endsWith('.map')).map((name) => `/${name}`), offlineUrl].sort();
      const worker = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
      const version = digest(JSON.stringify(assets) + worker);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker
        .replace('__BUILD_ID__', version).replace('__STATIC_ASSETS__', JSON.stringify(assets)).replace('__OFFLINE_URL__', offlineUrl) });
    },
  };
}
