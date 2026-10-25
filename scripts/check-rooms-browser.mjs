// Compatibility entry point: M4 room coverage now lives in the Playwright suite.
// Always use its isolated server; never write verification rooms to user data.
import { spawnSync } from 'node:child_process';
console.log('Room browser checks moved to npm run test:e2e. Using its isolated server on port 3197; ROOMS_ORIGIN is ignored.');
// The Windows command is constant, with no user text or unescaped arguments.
const result = process.platform === 'win32'
  ? spawnSync('npm.cmd run test:e2e', { stdio: 'inherit', shell: true, windowsHide: true })
  : spawnSync('npm', ['run', 'test:e2e'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
