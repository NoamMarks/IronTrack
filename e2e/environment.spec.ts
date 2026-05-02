import { test, expect } from '@playwright/test';

/**
 * Environment / harness coverage.
 *
 * Tests the cross-cutting concerns that the auth flows depend on but no
 * single screen owns:
 *   - Vite app actually mounts at the Vercel-dev origin (regression test
 *     for the catch-all /index.html rewrite that intercepted /main.tsx).
 *   - api/* routes are reachable and return JSON, not the SPA shell.
 *   - Magic-link URL detection routes ?invite= and /signup directly to
 *     the signup form, bypassing the landing page.
 *   - Theme preference persists through a reload.
 *   - Toasts surface on the pre-auth pages (regression test for the bug
 *     where setToast fired but Toast was only mounted inside AppShell).
 */

test.describe('Environment — Vite + Vercel dev integration', () => {
  test('the SPA bundle mounts and the login form renders without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await expect(page.getByTestId('login-btn')).toBeVisible();
    // Filter out third-party noise (DevTools advertisement, etc.) and assert
    // no app-level pageerrors / console.errors leaked.
    const appErrors = errors.filter((e) =>
      !/React DevTools/i.test(e) &&
      !/Download the React DevTools/i.test(e),
    );
    expect(appErrors, `Unexpected console errors: ${appErrors.join('\n')}`).toEqual([]);
  });

  test('Vite dev module paths return JS bodies, not the SPA shell', async ({ request }) => {
    // Regression test for the vercel.json rewrite bug: /(.*) -> /index.html
    // intercepted Vite's dev module paths (/src/main.tsx, /@vite/client,
    // /@react-refresh) and broke the page on first load. We assert on the
    // RESPONSE BODY rather than content-type because vercel dev's proxy
    // rewrites text/javascript -> text/html on some forwarded responses;
    // the body is what the browser actually parses.
    for (const path of ['/src/main.tsx', '/@vite/client', '/@react-refresh']) {
      const res = await request.get(path);
      expect(res.status(), `${path} must be served by Vite`).toBeLessThan(400);
      const body = await res.text();
      expect(
        body,
        `${path} body should be JS, got HTML — vercel.json rewrite is over-greedy`,
      ).not.toMatch(/^<!doctype html>/i);
    }
  });

  test('an unknown SPA route still serves the app shell (client-side routing fallback)', async ({ page }) => {
    // /signup is the canonical route Vercel must rewrite to index.html.
    const response = await page.goto('/signup');
    expect(response?.status(), 'rewrite must resolve to a 2xx').toBeLessThan(400);
    await expect(page.getByTestId('signup-name')).toBeVisible();
  });
});

test.describe('Environment — API routes reachable', () => {
  test('GET /api/admin-create-user returns a 405 with JSON (not the SPA shell)', async ({ request }) => {
    const res = await request.get('/api/admin-create-user');
    expect(res.status()).toBe(405);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('GET /api/signup-user returns a 405 with JSON (not the SPA shell)', async ({ request }) => {
    const res = await request.get('/api/signup-user');
    expect(res.status()).toBe(405);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('POST /api/signup-user with missing fields returns 400 + structured error', async ({ request }) => {
    const res = await request.post('/api/signup-user', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/missing|invalid/i);
  });

  test('OPTIONS preflight on /api/signup-user returns 204 with CORS headers', async ({ request }) => {
    const res = await request.fetch('/api/signup-user', { method: 'OPTIONS' });
    expect(res.status()).toBe(204);
    expect(res.headers()['access-control-allow-methods']).toMatch(/POST/);
  });
});

test.describe('Environment — magic-link routing', () => {
  test('?invite=CODE on the root URL routes straight to the signup form', async ({ page }) => {
    await page.goto('/?invite=DEMO1234');
    await expect(page.getByTestId('signup-name')).toBeVisible();
    // The invite field should be auto-filled (locked since it came from URL).
    await expect(page.getByTestId('signup-invite-code')).toHaveValue('DEMO1234');
  });

  test('the /signup pathname routes to the signup form even without an invite param', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByTestId('signup-name')).toBeVisible();
    await expect(page.getByTestId('signup-submit-btn')).toBeVisible();
  });

  test('?invite=BAD shows the "invite invalid" banner instead of the welcome banner', async ({ page }) => {
    await page.goto('/?invite=DEFINITELY_NOT_REAL');
    await expect(page.getByTestId('invite-invalid-banner')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('invite-welcome-banner')).toHaveCount(0);
  });
});

test.describe('Environment — theme preference persistence', () => {
  test('toggling the theme on the login page persists across a hard reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('login-btn')).toBeVisible();
    const initialIsDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );

    await page.locator('nav button').first().click();
    const flippedIsDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );
    expect(flippedIsDark).toBe(!initialIsDark);

    await page.reload();
    await expect(page.getByTestId('login-btn')).toBeVisible();
    const persistedIsDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );
    expect(persistedIsDark).toBe(flippedIsDark);
  });
});

test.describe('Environment — back/forward navigation', () => {
  test('using browser back from signup returns to the login form', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('goto-signup-btn').click();
    await expect(page.getByTestId('signup-name')).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId('login-btn')).toBeVisible();
  });

  test('using browser back from forgot-password returns to the login form', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('goto-forgot-btn').click();
    await expect(page.getByTestId('forgot-email')).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId('login-btn')).toBeVisible();
  });
});
