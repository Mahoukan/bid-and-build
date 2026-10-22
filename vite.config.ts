import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, root, ''), ...process.env };
  const target = `http://127.0.0.1:${env.PORT ?? '3000'}`;
  return {
    root: fileURLToPath(new URL('./client', import.meta.url)),
    // Root environment is server configuration, never a client env directory.
    envDir: false,
    plugins: [react()],
    build: { outDir: '../dist/client', emptyOutDir: true },
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
