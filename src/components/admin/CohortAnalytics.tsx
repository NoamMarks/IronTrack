import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { TechnicalCard } from '../ui';
import { cn } from '../../lib/utils';
import { complianceRate, listLoggedExercises } from '../../lib/analytics';
import type { Client, WorkoutDay } from '../../types';

interface CohortAnalyticsProps {
  trainees: Client[];
}

interface TraineeRow {
  client: Client;
  rate: number;
  logged: number;
  hasSessions: boolean;
  hasPRs: boolean;
  lastActiveAt: string | null;
}

/**
 * Coach-facing aggregate dashboard. Summarises every trainee in the
 * tenant: how many are active, the average compliance, total sessions
 * logged, and how many have at least one logged exercise (a proxy for
 * "has set a PR-tracked number"). Below the summary tiles, a row per
 * trainee with their compliance bar, session count, and last-active
 * relative timestamp.
 *
 * The component is purely presentational — no Supabase calls, no
 * mutations. It reads the same `clients` tree that AdminView already
 * has hydrated.
 */
export function CohortAnalytics({ trainees }: CohortAnalyticsProps) {
  // Per-trainee derived stats — one pass over the tree, then everything
  // else (the four summary tiles + the table) reads from this list.
  const rows = useMemo<TraineeRow[]>(() => {
    return trainees.map((client) => {
      const { logged, rate } = complianceRate(client);
      const lastActiveAt = mostRecentLoggedAt(client);
      return {
        client,
        rate,
        logged,
        hasSessions: logged > 0,
        hasPRs: listLoggedExercises(client).length > 0,
        lastActiveAt,
      };
    });
  }, [trainees]);

  const summary = useMemo(() => {
    const active = trainees.filter((c) => c.programs.some((p) => p.status !== 'archived')).length;
    const withSessions = rows.filter((r) => r.hasSessions);
    const avgCompliance = withSessions.length === 0
      ? 0
      : Math.round(
          withSessions.reduce((sum, r) => sum + r.rate, 0) / withSessions.length,
        );
    const totalSessions = rows.reduce((sum, r) => sum + r.logged, 0);
    const prsSet = rows.filter((r) => r.hasPRs).length;
    return { active, avgCompliance, totalSessions, prsSet };
  }, [trainees, rows]);

  // Compliance descending; ties broken by recency so the most engaged
  // trainees float to the top.
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => {
      if (b.rate !== a.rate) return b.rate - a.rate;
      const aTime = a.lastActiveAt ? Date.parse(a.lastActiveAt) : 0;
      const bTime = b.lastActiveAt ? Date.parse(b.lastActiveAt) : 0;
      return bTime - aTime;
    }),
    [rows],
  );

  if (trainees.length === 0) {
    return (
      <div
        data-testid="cohort-empty"
        className="flex flex-col items-center justify-center px-6 py-16 text-center"
      >
        <div className="w-12 h-12 border border-border/50 flex items-center justify-center mb-3">
          <Users className="w-5 h-5 text-muted-foreground" />
        </div>
        <p className="text-xs font-mono text-foreground uppercase tracking-widest">
          No trainees yet
        </p>
        <p className="text-[10px] font-mono text-muted-foreground/70 mt-2 max-w-xs leading-relaxed">
          Invite trainees from the panel above — cohort metrics light up once
          your first session is logged.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="cohort-analytics">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile label="Active Trainees" value={String(summary.active)} />
        <SummaryTile
          label="Avg Compliance"
          value={`${summary.avgCompliance}%`}
        />
        <SummaryTile label="Total Sessions" value={String(summary.totalSessions)} />
        <SummaryTile label="PRs Set" value={String(summary.prsSet)} />
      </div>

      {/* Trainee compliance table */}
      <TechnicalCard className="overflow-hidden">
        <div
          role="table"
          data-testid="cohort-table"
          className="font-mono"
        >
          <div
            role="row"
            className="grid grid-cols-[2fr_1.5fr_0.6fr_1fr] gap-4 px-5 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground border-b border-primary/20"
          >
            <span role="columnheader">Trainee</span>
            <span role="columnheader">Compliance</span>
            <span role="columnheader" className="text-right">Sessions</span>
            <span role="columnheader" className="text-right">Last Active</span>
          </div>

          {sortedRows.map((row) => (
            <TraineeRowView key={row.client.id} row={row} />
          ))}
        </div>
      </TechnicalCard>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <TechnicalCard>
      <div className="px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className="text-3xl font-display font-bold text-primary tabular-nums leading-tight mt-1">
          {value}
        </p>
      </div>
    </TechnicalCard>
  );
}

function TraineeRowView({ row }: { row: TraineeRow }) {
  const rateColor =
    row.rate >= 80 ? 'text-accent'
    : row.rate >= 50 ? 'text-primary'
    :                  'text-warning';

  return (
    <div
      role="row"
      data-testid={`cohort-row-${row.client.id}`}
      className="grid grid-cols-[2fr_1.5fr_0.6fr_1fr] gap-4 items-center px-5 py-3 border-b border-border/30 last:border-0 hover:bg-surface/50 transition-colors"
    >
      <span role="cell" className="font-display font-semibold text-sm text-foreground truncate">
        {row.client.name}
      </span>

      <span role="cell" className="flex items-center gap-3 min-w-0">
        {/* Compliance bar — pure CSS, no SVG. The fill width is set inline
            because Tailwind can't compile a dynamic width-N% class. */}
        <span className="flex-1 h-1.5 bg-surface border border-border/30 overflow-hidden">
          <span
            className="block h-full bg-primary/60"
            style={{ width: `${Math.max(0, Math.min(100, row.rate))}%` }}
          />
        </span>
        <span className={cn('text-xs font-mono tabular-nums shrink-0 w-10 text-right', rateColor)}>
          {row.rate}%
        </span>
      </span>

      <span role="cell" className="text-sm font-mono tabular-nums text-foreground/90 text-right">
        {row.logged}
      </span>

      <span role="cell" className="text-xs font-mono text-muted-foreground text-right truncate">
        {row.lastActiveAt
          ? `${formatDistanceToNow(new Date(row.lastActiveAt))} ago`
          : '—'}
      </span>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function mostRecentLoggedAt(client: Client): string | null {
  let latest: string | null = null;
  for (const program of client.programs) {
    for (const week of program.weeks) {
      for (const day of week.days as WorkoutDay[]) {
        if (!day.loggedAt) continue;
        if (latest === null || day.loggedAt > latest) latest = day.loggedAt;
      }
    }
  }
  return latest;
}
