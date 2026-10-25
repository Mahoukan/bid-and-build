import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

const envPath = fileURLToPath(new URL('./.env', import.meta.url));

export default defineConfig((): UserConfig => {
  // Read backend binding settings without Vite loadEnv's NODE_ENV side effect.
  // A backend development .env must never select development React in a build.
  const env = { ...(existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {}), ...process.env };
  const target = `http://127.0.0.1:${env.PORT ?? '3000'}`;
  return {
    root: fileURLToPath(new URL('./client', import.meta.url)),
    // Root environment is server configuration, never a client env directory.
    envDir: false,
    plugins: [react()],
    build: {
      outDir: '../dist/client', emptyOutDir: true,
      rolldownOptions: { output: { codeSplitting: { groups: [
        { name: 'validation', test: /node_modules[\\/]zod/ },
      ] } } },
    },
    server: {
      host: env.HOST ?? '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: Object.fromEntries(
        ['/api', '/health', '/media', '/socket.io'].map((path) => [
          path, { target, ws: path === '/socket.io', changeOrigin: false },
        ]),
      ),
    },
  };
});
