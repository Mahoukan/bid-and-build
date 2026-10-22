import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig, projectRoot } from '../server/config.js';

const validEnv = { SESSION_SECRET: 'test-only-'.repeat(8) };
describe('runtime configuration', () => {
  it('uses root-relative data paths and rejects invalid settings without exposing values', () => {
    expect(parseConfig(validEnv).dataDir).toBe(join(projectRoot, 'data'));
    expect(parseConfig({ ...validEnv, PORT: '3000' }).port).toBe(3000);
    for (const PORT of ['0', '3000.5', '-1', '65536', '3e3', '']) {
      expect(() => parseConfig({ ...validEnv, PORT })).toThrow('PORT');
    }
    for (const APP_ORIGIN of ['https://example.com/path', 'file:///tmp', 'https://user:pass@example.com', 'https://example.com/']) {
      expect(() => parseConfig({ ...validEnv, APP_ORIGIN })).toThrow('APP_ORIGIN');
    }
    expect(() => parseConfig({ SESSION_SECRET: 'do-not-log-me' })).toThrow('SESSION_SECRET');
    try { parseConfig({ SESSION_SECRET: 'do-not-log-me' }); } catch (error) {
      expect(String(error)).not.toContain('do-not-log-me');
    }
  });
  it('setup generates distinct secrets without outputting them and preserves existing bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-build-env-test-'));
    try {
      await writeFile(join(directory, '.env.example'), 'PORT=3000\nSESSION_SECRET=\n');
      const scriptUrl = new URL('../scripts/setup.mjs', import.meta.url).href;
      const run = () => execFileSync(process.execPath, ['--input-type=module', '-e',
        `import { setup } from ${JSON.stringify(scriptUrl)}; console.log(await setup(${JSON.stringify(directory)}));`,
      ], { encoding: 'utf8' });
      expect(run().trim()).toBe('true');
      const first = await readFile(join(directory, '.env'), 'utf8');
      expect(first).toMatch(/^SESSION_SECRET=[a-f0-9]{96}$/m);
      expect(run().trim()).toBe('false');
      expect(await readFile(join(directory, '.env'), 'utf8')).toBe(first);
      await rm(join(directory, '.env'));
      expect(run().trim()).toBe('true');
      expect(await readFile(join(directory, '.env'), 'utf8')).not.toBe(first);
      await writeFile(join(directory, '.env'), '# owner custom settings\r\nPORT=3099\r\n');
      expect(run().trim()).toBe('false');
      expect(await readFile(join(directory, '.env'), 'utf8')).toBe('# owner custom settings\r\nPORT=3099\r\n');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
