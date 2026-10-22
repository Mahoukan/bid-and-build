import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function setup(root) {
  const example = await readFile(resolve(root, '.env.example'), 'utf8');
  const contents = example.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${randomBytes(48).toString('hex')}`);
  try {
    await writeFile(resolve(root, '.env'), contents, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.versions.node.split('.')[0] !== '24') {
    console.error('Bid & Build requires Node 24 LTS. Select Node 24 and run setup again.');
    process.exitCode = 1;
  } else {
    const created = await setup(fileURLToPath(new URL('..', import.meta.url)));
    console.log(created ? 'Created .env with a private generated secret.' : 'Existing .env preserved.');
  }
}
