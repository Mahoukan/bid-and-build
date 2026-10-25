import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 90_000, expect: { timeout: 8000 }, workers: 1, fullyParallel: false,
  outputDir: '.cache/playwright/results', reporter: [['list'], ['html', { outputFolder: '.cache/playwright/report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:3197', viewport: { width: 1280, height: 720 }, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {} },
  webServer: { command: 'node --import tsx scripts/e2e-server.mjs', url: 'http://127.0.0.1:3197/health', reuseExistingServer: false, timeout: 30_000 },
});
