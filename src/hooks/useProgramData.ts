import { useState, useEffect, useCallback } from 'react';
import type { Client, Program, WorkoutDay, ExercisePlan, ProgramColumn, UserRole } from '../types';
import { INITIAL_CLIENTS, DEFAULT_COLUMNS, SUPERADMIN_EMAIL } from '../constants/mockData';
import { hashPassword, isHashed } from '../lib/crypto';

const STORAGE_KEY = 'irontrack_clients';

// ─── Migration helper ────────────────────────────────────────────────────────

async function migrateClients(raw: unknown[]): Promise<Client[]> {
  let clients: Client[] = await Promise.all(
    raw.map(async (c: unknown) => {
      const client = c as Record<string, unknown>;
      const rawPassword = (client.password as string) ?? 'changeme';
      const password = isHashed(rawPassword) ? rawPassword : await hashPassword(rawPassword);

      // Migrate legacy 'coach' role → 'admin'
      let role = (client.role as string) ?? 'trainee';
      if (role === 'coach') role = 'admin';

      return {
        ...(client as unknown as Client),
        role: role as UserRole,
        password,
        tenantId: (client.tenantId as string | undefined),
        programs: ((client.programs as unknown[]) ?? []).map((p: unknown) => {
          const prog = p as Record<string, unknown>;
          return {
            ...(prog as unknown as Program),
            status: ((prog.status as 'active' | 'archived') ?? 'active'),
            columns: (prog.columns as ProgramColumn[]) ?? [...DEFAULT_COLUMNS],
            tenantId: (prog.tenantId as string | undefined),
            weeks: ((prog.weeks as unknown[]) ?? []).map((w: unknown) => {
              const week = w as Record<string, unknown>;
              return {
                ...(week as unknown as Program['weeks'][0]),
                days: ((week.days as unknown[]) ?? []).map((d: unknown) => {
                  const day = d as Record<string, unknown>;
                  return {
                    ...(day as unknown as WorkoutDay),
                    exercises: ((day.exercises as unknown[]) ?? []).map((ex: unknown) => ({
                      ...(ex as ExercisePlan),
                      values:
                        ((ex as Record<string, unknown>).values as Record<string, string>) ?? {},
                    })),
                  };
                }),
              };
            }),
          };
        }),
      };
    })
  );

  // Force-migrate the superadmin account — stale localStorage may have the
  // wrong role/tenantId from before the multi-tenant sprint. Only mutate when
  // actually needed so reload-after-reload doesn't churn through writes.
  const superadminEmail = SUPERADMIN_EMAIL.toLowerCase();
  const existingSA = clients.find((c) => c.email.toLowerCase() === superadminEmail);
  if (existingSA) {
    if (existingSA.role !== 'superadmin') existingSA.role = 'superadmin';
    if (existingSA.tenantId !== 'global') existingSA.tenantId = 'global';
  } else {
    // Superadmin doesn't exist at all — bootstrap from seed data
    const hashedSA = await hashInitialClients([INITIAL_CLIENTS[0]]);
    clients = [...hashedSA, ...clients];
  }

  // Ensure at least one admin (coach) exists
  if (!clients.some((c) => c.role === 'admin')) {
    const coachSeed = INITIAL_CLIENTS.find((c) => c.role === 'admin');
    if (coachSeed) {
      const hashedCoach = await hashInitialClients([coachSeed]);
      clients = [...clients, ...hashedCoach];
    }
  }

  return clients;
}

async function hashInitialClients(list: Client[]): Promise<Client[]> {
  return Promise.all(
    list.map(async (c) => ({
      ...c,
      password: isHashed(c.password ?? '') ? (c.password ?? '') : await hashPassword(c.password ?? ''),
    }))
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useProgramData() {
  const [clients, setClients] = useState<Client[]>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  /**
   * Read-merge-write helper: every clients mutation MUST go through this.
   *
   * Why: previously each mutation captured `clients` in its useCallback closure,
   * then awaited (e.g., hashPassword), then wrote `[...clients, new]` back.
   * If anything else updated the clients store while the await was pending,
   * the write clobbered that change with a stale snapshot. Reading from
   * localStorage immediately before the write makes localStorage the durable
   * source of truth; the React state is just a derived cache.
   *
   * The updater receives the freshest persisted clients and returns the next
   * state. If it returns the same reference (no-op), we don't write.
   */
  const persistClients = useCallback((updater: (current: Client[]) => Client[]): Client[] => {
    let current: Client[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) current = JSON.parse(raw) as Client[];
    } catch (err) {
      console.error('[IronTrack persist] failed to read clients from localStorage', err);
    }
    const next = updater(current);
    if (next === current) return current;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setClients(next);
    return next;
  }, []);

  // Bootstrap runs once on mount. Async hashing creates a window where another
  // mutation could write to localStorage; we merge any concurrent additions
  // back in at write time so they aren't clobbered.
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const saved = localStorage.getItem(STORAGE_KEY);
      let baseline: Client[];
      if (saved) {
        try {
          baseline = await migrateClients(JSON.parse(saved) as unknown[]);
        } catch (err) {
          console.error('[IronTrack bootstrap] failed to migrate, using seed', err);
          baseline = await hashInitialClients(INITIAL_CLIENTS);
        }
      } else {
        baseline = await hashInitialClients(INITIAL_CLIENTS);
      }
      if (cancelled) return;

      // Merge: preserve any clients that were added to localStorage *during*
      // the async migration window (they won't appear in `baseline`).
      persistClients((current) => {
        const baselineIds = new Set(baseline.map((c) => c.id));
        const concurrent = current.filter((c) => !baselineIds.has(c.id));
        return concurrent.length === 0 ? baseline : [...baseline, ...concurrent];
      });
      setIsBootstrapping(false);
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [persistClients]);

  /**
   * Backwards-compat shim for callers (e.g. AdminView) that have already
   * computed the full new array. Routes through persistClients so the same
   * read-before-write discipline is preserved.
   */
  const updateClients = useCallback(
    (updated: Client[]) => {
      persistClients(() => updated);
    },
    [persistClients],
  );

  const addClient = useCallback(
    async (name: string, email: string, password: string, role: UserRole = 'trainee', tenantId?: string) => {
      // Trim email + password BEFORE hashing so a fresh signup hash matches the
      // login hash — login itself trims password before hashing, so any
      // accidental trailing whitespace here would cause a silent auth mismatch.
      const trimmedEmail = email.trim();
      const trimmedPassword = password.trim();
      const hashed = await hashPassword(trimmedPassword);
      const id = Math.random().toString(36).substring(7);

      // Tenant enforcement: every non-superadmin must have a tenantId.
      // - admin (coach): own id is the tenant root, even if caller forgot to pass one
      // - trainee: must inherit a coach's tenantId; refuse to create an orphan
      let resolvedTenantId = tenantId?.trim() || undefined;
      if (role === 'admin') {
        resolvedTenantId = resolvedTenantId ?? id;
      } else if (role === 'trainee' && !resolvedTenantId) {
        const err = new Error('addClient: trainee creation requires a non-empty tenantId');
        console.error('[IronTrack addClient]', err, { name, email: trimmedEmail, role, tenantId });
        throw err;
      } else if (role === 'superadmin') {
        resolvedTenantId = 'global';
      }

      const newClient: Client = {
        id,
        name: name.trim(),
        email: trimmedEmail,
        password: hashed,
        role,
        tenantId: resolvedTenantId,
        programs: [],
      };
      // Append to whatever's actually in localStorage right now, NOT to the
      // closure copy of `clients`. This is the core stale-closure fix.
      persistClients((current) => [...current, newClient]);
      return newClient;
    },
    [persistClients],
  );

  const resetPassword = useCallback(
    async (clientId: string, newPassword: string) => {
      // Trim before hashing so the stored hash matches what login produces from
      // the typed password (login trims; addClient trims; resetPassword must
      // too — otherwise password "Pass1 " wouldn't authenticate as "Pass1").
      const hashed = await hashPassword(newPassword.trim());
      let found = false;
      persistClients((current) => {
        if (!current.some((c) => c.id === clientId)) return current;
        found = true;
        return current.map((c) => (c.id === clientId ? { ...c, password: hashed } : c));
      });
      if (!found) {
        // Existence check runs against the FRESHEST persisted state, not a
        // stale closure — a silent no-op (the original bug) is now impossible.
        const err = new Error(`resetPassword: no client found with id "${clientId}"`);
        console.error('[IronTrack resetPassword]', err);
        throw err;
      }
    },
    [persistClients],
  );

  const saveSession = useCallback(
    (clientId: string, programId: string, weekId: string, updatedDay: WorkoutDay) => {
      const stampedDay: WorkoutDay = { ...updatedDay, loggedAt: new Date().toISOString() };
      persistClients((current) => {
        // Defensive checks against the LATEST persisted state — if the user,
        // program, week, or day no longer exists, refuse the write. This is
        // the only check we can do client-side; true tenant security needs a backend.
        const target = current.find((c) => c.id === clientId);
        if (!target) return current;
        const program = target.programs.find((p) => p.id === programId);
        if (!program || program.status === 'archived') return current;
        const week = program.weeks.find((w) => w.id === weekId);
        if (!week || !week.days.some((d) => d.id === stampedDay.id)) return current;

        return current.map((c) => {
          if (c.id !== clientId) return c;
          return {
            ...c,
            programs: c.programs.map((p) => {
              if (p.id !== programId) return p;
              return {
                ...p,
                weeks: p.weeks.map((w) => {
                  if (w.id !== weekId) return w;
                  return {
                    ...w,
                    days: w.days.map((d) => (d.id === stampedDay.id ? stampedDay : d)),
                  };
                }),
              };
            }),
          };
        });
      });
    },
    [persistClients],
  );

  const deleteClient = useCallback(
    (clientId: string) => {
      persistClients((current) => current.filter((c) => c.id !== clientId));
    },
    [persistClients],
  );

  const archiveProgram = useCallback(
    (clientId: string, programId: string) => {
      persistClients((current) => current.map((c) => {
        if (c.id !== clientId) return c;
        const wasActive = c.activeProgramId === programId;
        return {
          ...c,
          activeProgramId: wasActive ? undefined : c.activeProgramId,
          programs: c.programs.map((p) =>
            p.id === programId
              ? { ...p, status: 'archived' as const, archivedAt: new Date().toISOString() }
              : p,
          ),
        };
      }));
    },
    [persistClients],
  );

  /**
   * Filter clients by tenant. Superadmin sees all; coaches see only their tenant.
   */
  const getClientsForTenant = useCallback(
    (user: Client): Client[] => {
      if (user.role === 'superadmin') return clients;
      return clients.filter((c) => c.tenantId === user.tenantId && c.id !== user.id);
    },
    [clients]
  );

  return {
    clients,
    isBootstrapping,
    updateClients,
    addClient,
    saveSession,
    deleteClient,
    resetPassword,
    archiveProgram,
    getClientsForTenant,
  };
}