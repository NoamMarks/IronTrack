import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface ActivityEntry {
  dayId: string;
  dayName: string;
  difficulty: number | null;
  note: string | null;
  reflectionAt: string;
  loggedAt: string | null;
  programId: string;
  programName: string;
  traineeId: string;
  traineeName: string;
  coachNote: string | null;
}

interface UseRecentActivityResult {
  entries: ActivityEntry[];
  isLoading: boolean;
  /** True only on the very first fetch — subsequent refetches keep entries
   *  in place so the UI doesn't flash a loading state on every realtime
   *  ping. Falls back to `isLoading` when no entries are available yet. */
  isInitialLoad: boolean;
}

/**
 * Reads the latest reflections for a coach's tenant. Fetches once on mount
 * (and on tenant change) and re-fetches whenever the realtime channel
 * reports an UPDATE on `days` whose `reflection_at` flipped from NULL to a
 * timestamp. Refetches are cheap (20 rows, indexed) so we keep the data path
 * simple instead of mutating local state from realtime payloads.
 *
 * Realtime delivery is gated by RLS on the `days` SELECT policy and by
 * the `supabase_realtime` publication including `days` (see migration
 * 2026-05-08_post_workout_reflections.sql).
 *
 * Returns `{ entries: [], isLoading: false }` when `tenantId` is null —
 * superadmins viewing the global panel haven't picked a tenant yet, and
 * unauthenticated callers shouldn't trigger a query at all.
 */
export function useRecentActivity(tenantId: string | null | undefined): UseRecentActivityResult {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Track the active channel + tenant in refs so the realtime callback can
  // close over the latest tenantId without retriggering subscription
  // teardown on every fetch.
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetch = useCallback(async (tid: string) => {
    setIsLoading(true);
    try {
      // Pull days with a non-null reflection_at, joined up through weeks →
      // programs to filter by tenant. The trainee name lives on profiles
      // via programs.client_id; we resolve those in a second pass to avoid
      // PostgREST's auto-FK-name guessing on the nested embed.
      const { data: dayRows, error: dayErr } = await supabase
        .from('days')
        .select(`
          id, name, difficulty, reflection_note, reflection_at, logged_at, coach_note,
          weeks!inner (
            programs!inner (
              id, name, tenant_id, client_id
            )
          )
        `)
        .eq('weeks.programs.tenant_id', tid)
        .not('reflection_at', 'is', null)
        .order('reflection_at', { ascending: false })
        .limit(20);

      if (dayErr) throw dayErr;

      // PostgREST returns nested arrays for embedded relations even when
      // the FK is many-to-one. Each `days` row will have weeks: [{...}]
      // and weeks[0].programs: [{...}] (or {...} depending on the version);
      // normalise both shapes.
      const rows = (dayRows ?? []).map((r) => {
        const weekRel = Array.isArray(r.weeks) ? r.weeks[0] : r.weeks;
        const programRel = weekRel
          ? (Array.isArray(weekRel.programs) ? weekRel.programs[0] : weekRel.programs)
          : null;
        return {
          dayId: r.id as string,
          dayName: (r.name ?? 'Workout') as string,
          difficulty: (r.difficulty as number | null) ?? null,
          note: (r.reflection_note as string | null) ?? null,
          reflectionAt: r.reflection_at as string,
          loggedAt: (r.logged_at as string | null) ?? null,
          coachNote: (r.coach_note as string | null) ?? null,
          programId: (programRel?.id ?? '') as string,
          programName: (programRel?.name ?? '') as string,
          clientId: (programRel?.client_id ?? '') as string,
        };
      });

      const clientIds = Array.from(new Set(rows.map((r) => r.clientId).filter(Boolean)));
      let nameById = new Map<string, string>();
      if (clientIds.length > 0) {
        const { data: profileRows, error: profErr } = await supabase
          .from('profiles')
          .select('id, name')
          .in('id', clientIds);
        if (profErr) throw profErr;
        nameById = new Map(
          (profileRows ?? []).map((p) => [p.id as string, (p.name as string) ?? '']),
        );
      }

      const next: ActivityEntry[] = rows.map((r) => ({
        dayId: r.dayId,
        dayName: r.dayName,
        difficulty: r.difficulty,
        note: r.note,
        reflectionAt: r.reflectionAt,
        loggedAt: r.loggedAt,
        coachNote: r.coachNote,
        programId: r.programId,
        programName: r.programName,
        traineeId: r.clientId,
        traineeName: nameById.get(r.clientId) ?? '—',
      }));
      setEntries(next);
    } catch (err) {
      console.error('[IronTrack activity] fetch failed', err);
    } finally {
      setIsLoading(false);
      setIsInitialLoad(false);
    }
  }, []);

  // ─── Initial fetch + realtime subscription ───────────────────────────
  useEffect(() => {
    if (!tenantId) {
      setEntries([]);
      setIsInitialLoad(false);
      return;
    }

    // Reset entries on tenant switch so the panel doesn't flash the
    // previous coach's data while the new fetch is in flight.
    setIsInitialLoad(true);
    void fetch(tenantId);

    // Tear down the previous channel before opening a new one. The first
    // mount has channelRef.current === null, so this is a no-op then.
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`recent-activity-${tenantId}`)
      .on(
        'postgres_changes',
        // Listen on every change to `days`. RLS filters out anything the
        // caller can't SELECT; the JS callback further restricts to events
        // where reflection_at went from null → not-null (i.e. a fresh
        // reflection was just submitted).
        { event: 'UPDATE', schema: 'public', table: 'days' },
        (payload) => {
          const newRow = payload.new as { reflection_at?: string | null } | null;
          if (!newRow?.reflection_at) return;
          void fetch(tenantId);
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[IronTrack activity] realtime subscription degraded:', status);
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [tenantId, fetch]);

  return { entries, isLoading, isInitialLoad: isInitialLoad && entries.length === 0 };
}
