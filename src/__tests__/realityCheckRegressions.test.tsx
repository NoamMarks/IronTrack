/**
 * "Reality Check" regressions:
 *
 *  - Mutations (addClient, resetPassword) MUST read from localStorage at write
 *    time, not from a stale React/closure snapshot. Tests below simulate the
 *    bug by mutating localStorage *between* the time the React state was last
 *    set and the time the mutation runs — the previous implementation would
 *    overwrite that change; the new implementation preserves it.
 *
 *  - buildInviteLink MUST honour VITE_PUBLIC_URL when set, and fall back to
 *    window.location.origin when not.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { useProgramData } from '../hooks/useProgramData';
import { buildInviteLink } from '../lib/inviteCodes';
import type { Client } from '../types';

const STORAGE_KEY = 'irontrack_clients';

beforeEach(() => {
  localStorage.clear();
});

// ─── Stale-closure resilience ──────────────────────────────────────────────

async function bootstrapHook() {
  const ref: { current: ReturnType<typeof useProgramData> | null } = { current: null };
  const Harness = () => {
    ref.current = useProgramData();
    return null;
  };
  render(<Harness />);
  await waitFor(() => expect(ref.current?.isBootstrapping).toBe(false));
  return ref;
}

function readStored(): Client[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Client[]) : [];
}

function injectExtra(extra: Client) {
  // Simulate a concurrent write to localStorage (another tab, a stale
  // closure, or a parallel mutation that already committed). After this,
  // the React state is "stale" relative to localStorage.
  const current = readStored();
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...current, extra]));
}

const EXTRA_CLIENT: Client = {
  id: 'concurrent1',
  name: 'Concurrent User',
  email: 'concurrent@test.com',
  password: 'somehash',
  role: 'trainee',
  tenantId: 'tenant-A',
  programs: [],
};

describe('addClient is resilient to stale React state', () => {
  it('preserves a concurrent localStorage entry when adding a new client', async () => {
    const ref = await bootstrapHook();

    // Inject a "concurrent" client directly into localStorage. React state is
    // now out of sync — it doesn't know about EXTRA_CLIENT.
    injectExtra(EXTRA_CLIENT);

    let created: Client | null = null;
    await act(async () => {
      created = await ref.current!.addClient(
        'New Trainee',
        'new@test.com',
        'Password1',
        'trainee',
        'tenant-A',
      );
    });

    // The new client AND the concurrent client should both be in localStorage.
    // The previous implementation would have written `[...staleClients, new]`
    // and clobbered EXTRA_CLIENT.
    const stored = readStored();
    expect(stored.find((c) => c.id === EXTRA_CLIENT.id)).toBeDefined();
    expect(stored.find((c) => c.id === created!.id)).toBeDefined();
  });
});

describe('resetPassword is resilient to stale React state', () => {
  it('finds the user via fresh localStorage even if React state never saw them', async () => {
    const ref = await bootstrapHook();

    // Inject a user directly into localStorage. React state still doesn't
    // contain EXTRA_CLIENT, but the lookup-and-update path should now read
    // from localStorage and find them.
    injectExtra(EXTRA_CLIENT);

    await expect(
      ref.current!.resetPassword(EXTRA_CLIENT.id, 'NewPass1'),
    ).resolves.not.toThrow();

    // The password should be updated in localStorage
    const stored = readStored();
    const updated = stored.find((c) => c.id === EXTRA_CLIENT.id);
    expect(updated).toBeDefined();
    expect(updated!.password).not.toBe(EXTRA_CLIENT.password);
  });

  it('still throws when the clientId is genuinely unknown', async () => {
    const ref = await bootstrapHook();
    await expect(
      ref.current!.resetPassword('genuinely-missing', 'NewPass1'),
    ).rejects.toThrow(/no client found/i);
  });
});

describe('addClient writes are durable across React state churn', () => {
  it('localStorage reflects the new client immediately, before React re-renders', async () => {
    const ref = await bootstrapHook();

    let created: Client | null = null;
    await act(async () => {
      created = await ref.current!.addClient('Durable', 'durable@test.com', 'Password1', 'trainee', 'tenant-A');
    });

    // Even if a re-render hasn't fully propagated yet, localStorage IS the
    // source of truth — login on a refresh would still find the user.
    const stored = readStored();
    expect(stored.find((c) => c.email === 'durable@test.com')).toBeDefined();
    expect(stored.find((c) => c.id === created!.id)).toBeDefined();
  });
});

// ─── buildInviteLink env-var fallback ──────────────────────────────────────

describe('buildInviteLink honours VITE_PUBLIC_URL', () => {
  const ORIGINAL_ENV = { ...import.meta.env };

  afterEach(() => {
    // Restore original env between tests
    Object.assign(import.meta.env, ORIGINAL_ENV);
  });

  it('uses window.location.origin when VITE_PUBLIC_URL is unset', () => {
    vi.stubEnv('VITE_PUBLIC_URL', '');
    const link = buildInviteLink('ABC123');
    expect(link).toBe(`${window.location.origin}/signup?invite=ABC123`);
  });

  it('uses VITE_PUBLIC_URL when set', () => {
    vi.stubEnv('VITE_PUBLIC_URL', 'https://irontrack.vercel.app');
    const link = buildInviteLink('ABC123');
    expect(link).toBe('https://irontrack.vercel.app/signup?invite=ABC123');
  });

  it('strips trailing slashes from VITE_PUBLIC_URL for clean concatenation', () => {
    vi.stubEnv('VITE_PUBLIC_URL', 'https://irontrack.vercel.app/');
    const link = buildInviteLink('ABC123');
    expect(link).toBe('https://irontrack.vercel.app/signup?invite=ABC123');
  });

  it('falls back to origin when VITE_PUBLIC_URL is whitespace-only', () => {
    vi.stubEnv('VITE_PUBLIC_URL', '   ');
    const link = buildInviteLink('ABC123');
    expect(link).toBe(`${window.location.origin}/signup?invite=ABC123`);
  });
});
