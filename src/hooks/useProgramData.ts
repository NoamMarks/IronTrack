import { useState, useEffect, useCallback } from 'react';
import type { Client, Program, WorkoutDay, ExercisePlan, ProgramColumn } from '../types';
import { INITIAL_CLIENTS, DEFAULT_COLUMNS } from '../constants/mockData';
import { hashPassword, isHashed } from '../lib/crypto';

const STORAGE_KEY = 'irontrack_clients';

// ─── Migration helper ────────────────────────────────────────────────────────

async function migrateClients(raw: unknown[]): Promise<Client[]> {
  let clients: Client[] = await Promise.all(
    raw.map(async (c: unknown) => {
      const client = c as Record<string, unknown>;
      const rawPassword = (client.password as string) ?? 'changeme';
      // Hash any password that was stored in plaintext
      const password = isHashed(rawPassword) ? rawPassword : await hashPassword(rawPassword);
      return {
        ...(client as unknown as Client),
        role: (client.role as 'coach' | 'trainee') ?? 'trainee',
        password,
        programs: ((client.programs as unknown[]) ?? []).map((p: unknown) => {
          const prog = p as Record<string, unknown>;
          return {
            ...(prog as unknown as Program),
            columns: (prog.columns as ProgramColumn[]) ?? [...DEFAULT_COLUMNS],
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

  if (!clients.some((c) => c.role === 'coach')) {
    const hashedCoach = await hashInitialClients([INITIAL_CLIENTS[0]]);
    clients = [...hashedCoach, ...clients];
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

  useEffect(() => {
    async function bootstrap() {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as unknown[];
          const migrated = await migrateClients(parsed);
          setClients(migrated);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        } catch {
          const initial = await hashInitialClients(INITIAL_CLIENTS);
          setClients(initial);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
        }
      } else {
        const initial = await hashInitialClients(INITIAL_CLIENTS);
        setClients(initial);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      }
      setIsBootstrapping(false);
    }
    bootstrap();
  }, []);

  const updateClients = useCallback((updated: Client[]) => {
    setClients(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  const addClient = useCallback(
    async (name: string, email: string, password: string) => {
      const hashed = await hashPassword(password);
      const newClient: Client = {
        id: Math.random().toString(36).substring(7),
        name,
        email,
        password: hashed,
        role: 'trainee',
        programs: [],
      };
      updateClients([...clients, newClient]);
    },
    [clients, updateClients]
  );

  const saveSession = useCallback(
    (clientId: string, programId: string, weekId: string, updatedDay: WorkoutDay) => {
      const updated = clients.map((c) => {
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
                  days: w.days.map((d) => (d.id === updatedDay.id ? updatedDay : d)),
                };
              }),
            };
          }),
        };
      });
      updateClients(updated);
    },
    [clients, updateClients]
  );

  const deleteClient = useCallback(
    (clientId: string) => {
      updateClients(clients.filter((c) => c.id !== clientId));
    },
    [clients, updateClients]
  );

  return { clients, isBootstrapping, updateClients, addClient, saveSession, deleteClient };
}
