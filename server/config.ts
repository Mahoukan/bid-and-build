import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

function findProjectRoot() {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(directory, 'package.json'))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error('Cannot locate project root.');
    directory = parent;
  }
  return directory;
}

export const projectRoot = findProjectRoot();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.string().regex(/^\d+$/).default('3000').transform(Number).pipe(z.number().int().min(1).max(65535)),
  DATA_DIR: z.string().min(1).default('./data'),
  APP_ORIGIN: z.url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  }, 'Use an HTTP(S) origin without a path or trailing slash.').default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(64).max(1024),
});

export function parseConfig(environment: NodeJS.ProcessEnv, root = projectRoot) {
  const result = envSchema.safeParse(environment);
  if (!result.success) {
    // Report keys, never values: environment values may contain secrets.
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid configuration: ${keys.join(', ')}. See .env.example; run npm run setup for a missing .env.`);
  }
  const env = result.data;
  return {
    mode: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    dataDir: resolve(root, env.DATA_DIR),
    appOrigin: env.APP_ORIGIN,
    sessionSecret: env.SESSION_SECRET,
    clientDir: resolve(root, 'dist/client'),
  };
}

export type AppConfig = ReturnType<typeof parseConfig>;

export function loadConfig(): AppConfig {
  if (process.versions.node.split('.')[0] !== '24') {
    throw new Error('Bid & Build requires Node 24 LTS.');
  }
  const envPath = resolve(projectRoot, '.env');
  if (existsSync(envPath)) loadEnvFile(envPath);
  // Existing process environment takes precedence over .env (including in Docker).
  return parseConfig(process.env);
}
