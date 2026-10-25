// Sequential isolated shards avoid sharing one IP's real production rate-limit
// budget across unrelated browser scenarios. No application limits are relaxed.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'node_modules/@playwright/test/cli.js');
function run(args, env = {}) {
  return new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true });
    child.once('error', reject); child.once('exit', (code) => resolveCode(code ?? 1));
  });
}

const filters = process.argv.slice(2);
if (filters.length) {
  process.exitCode = await run(['test', ...filters]);
} else {
  const artifacts = resolve(root, '.cache/playwright');
  await mkdir(artifacts, { recursive: true });
  const runDirectory = await mkdtemp(join(artifacts, 'run-'));
  const blobs = join(runDirectory, 'blobs'); await mkdir(blobs);
  let failed = false;
  for (let shard = 1; shard <= 4; shard++) {
    const code = await run(['test', '--fully-parallel', '--workers=1', `--shard=${shard}/4`, '--reporter=list,blob', `--output=${join(runDirectory, `shard-${shard}`)}`], {
      PLAYWRIGHT_BLOB_OUTPUT_FILE: join(blobs, `shard-${shard}.zip`),
    });
    failed ||= code !== 0;
  }
  const merged = await run(['merge-reports', '--reporter=html', blobs], { PLAYWRIGHT_HTML_OUTPUT_DIR: join(artifacts, 'report'), PLAYWRIGHT_HTML_OPEN: 'never' });
  console.log(`Browser artifacts: ${runDirectory}`);
  process.exitCode = failed || merged !== 0 ? 1 : 0;
}
