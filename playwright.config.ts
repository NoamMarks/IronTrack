import { defineConfig } from '@playwright/test';

/**
 * Playwright config — points at `vercel dev` on :3000 so api/* routes are
 * exercised end-to-end (the signup flow now POSTs /api/signup-user, which
 * plain `npm run dev` doesn't host).
 *
 * If port 3000 is free Playwright will spin up `vercel dev` itself; if a
 * dev server is already running it reuses it.
 *
 * Set `PLAYWRIGHT_BASE_URL` to retarget the suite at a deployed URL (e.g.
 * production verification). When set, the local webServer config is
 * skipped — we don't need a dev server for an external target.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const useExternalTarget = !!process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
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
  webServer: useExternalTarget
    ? undefined
    : {
        command: 'npx vercel dev',
        port: 3000,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
