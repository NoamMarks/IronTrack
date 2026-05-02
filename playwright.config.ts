import { defineConfig } from '@playwright/test';

/**
 * Playwright config — points at `vercel dev` on :3000 so api/* routes are
 * exercised end-to-end (the signup flow now POSTs /api/signup-user, which
 * plain `npm run dev` doesn't host).
 *
 * If port 3000 is free Playwright will spin up `vercel dev` itself; if a
 * dev server is already running it reuses it.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'npx vercel dev',
    port: 3000,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
