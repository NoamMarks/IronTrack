import { useMemo } from 'react';
import { Trophy, TrendingUp, TrendingDown } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { motion } from 'motion/react';
import { TechnicalCard, Button } from '../ui';
import { cn } from '../../lib/utils';
import {
  estimate1RM,
  getLoadedSets,
  personalRecord,
} from '../../lib/analytics';
import type { Client, Program, WorkoutDay, ExercisePlan } from '../../types';

interface WorkoutSummaryProps {
  day: WorkoutDay;
  client: Client;
  program: Program;
  onClose: () => void;
  onSubmitReflection: () => void;
}

interface PrCallout {
  exerciseName: string;
  e1rm: number;
}

/**
 * Celebratory end-of-workout overlay surfaced between the trainee tapping
 * "Finish Workout" and the reflection modal. Reads exclusively from the
 * in-memory session (passed via `day`) plus the historical clients tree
 * (passed via `client`) — no Supabase calls.
 *
 * Renders as a full-viewport overlay (not via the `Modal` component) so the
 * celebration gets the full screen and the corner-bracket FUI treatment can
 * sit at the viewport edges rather than inside a 448px panel.
 */
export function WorkoutSummary({
  day,
  client,
  program,
  onClose,
  onSubmitReflection,
}: WorkoutSummaryProps) {
  // ─── Stats ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let setsLogged = 0;
    let totalVolume = 0;
    const rpeValues: number[] = [];

    for (const ex of day.exercises) {
      const repCount = parseRepsNumeric(ex.reps);
      for (let n = 1; n <= maxSetIndex(ex); n += 1) {
        const load = parseFloat(ex.values?.[`set_${n}_load`] ?? '');
        const rpe = parseFloat(ex.values?.[`set_${n}_rpe`] ?? '');
        const completed = ex.values?.[`set_${n}_completed`] === '1';
        const hasLoad = Number.isFinite(load) && load > 0;
        const hasRpe = Number.isFinite(rpe) && rpe > 0;

        // "Logged" = trainee gave us evidence the set happened: any of
        // load / rpe / completed flag.
        if (hasLoad || hasRpe || completed) setsLogged += 1;
        if (hasLoad && repCount !== null) totalVolume += load * repCount;
        if (hasRpe) rpeValues.push(rpe);
      }

      // Set-1 legacy mirror — analytics writes the set-1 load to
      // ex.actualLoad / ex.actualRpe too. Only fold them in when the
      // per-set keys didn't already cover that data, to avoid double
      // counting.
      if (
        !ex.values?.set_1_load
        && ex.actualLoad
        && Number.isFinite(parseFloat(ex.actualLoad))
        && repCount !== null
      ) {
        const v = parseFloat(ex.actualLoad);
        if (v > 0) totalVolume += v * repCount;
      }
    }

    const avgRpe = rpeValues.length === 0
      ? null
      : Math.round((rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length) * 10) / 10;

    return {
      setsLogged,
      totalVolume: Math.round(totalVolume * 10) / 10,
      avgRpe,
    };
  }, [day.exercises]);

  // ─── PR callouts ──────────────────────────────────────────────────────
  // For each exercise in today's session, compute today's best e1RM, then
  // compare against the historical PR with today's data EXCLUDED. If today
  // beats history, render a callout. We synthesise an "everything except
  // today" client by filtering days where loggedAt < today's loggedAt.
  const prCallouts = useMemo<PrCallout[]>(() => {
    if (!day.loggedAt) return [];
    const todayIso = day.loggedAt;
    const clientWithoutToday: Client = {
      ...client,
      programs: client.programs.map((p) => ({
        ...p,
        weeks: p.weeks.map((w) => ({
          ...w,
          days: w.days.filter((d) => !d.loggedAt || d.loggedAt < todayIso),
        })),
      })),
    };

    const out: PrCallout[] = [];
    const seenExerciseIds = new Set<string>();
    for (const ex of day.exercises) {
      if (seenExerciseIds.has(ex.exerciseId)) continue;
      seenExerciseIds.add(ex.exerciseId);

      const todayBest = bestE1RMForExercise(day, ex.exerciseId);
      if (todayBest === null) continue;

      const historical = personalRecord(clientWithoutToday, ex.exerciseId);
      if (historical === null || todayBest > historical.e1rm) {
        out.push({ exerciseName: ex.exerciseName, e1rm: todayBest });
      }
    }
    return out.sort((a, b) => b.e1rm - a.e1rm);
  }, [day, client]);

  const visiblePRs = prCallouts.slice(0, 3);
  const extraPRs = Math.max(0, prCallouts.length - visiblePRs.length);

  // ─── vs previous same-dayNumber session in this program ──────────────
  const comparison = useMemo(() => {
    const prior = findPriorSameDay(program, day);
    if (!prior) return null;
    const priorStats = computeSessionStats(prior);
    const volumeDelta = Math.round((stats.totalVolume - priorStats.totalVolume) * 10) / 10;
    const rpeDelta =
      stats.avgRpe === null || priorStats.avgRpe === null
        ? null
        : Math.round((stats.avgRpe - priorStats.avgRpe) * 10) / 10;
    return { volumeDelta, rpeDelta, priorDate: prior.loggedAt ?? null };
  }, [program, day, stats]);

  // ─── Render ───────────────────────────────────────────────────────────
  const formattedDate = day.loggedAt
    ? format(parseISO(day.loggedAt), 'EEEE, MMM d')
    : null;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Workout complete"
      data-testid="workout-summary"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="fixed inset-0 z-[200] bg-background/95 backdrop-blur-md overflow-y-auto"
    >
      <div className="relative max-w-2xl mx-auto px-5 py-12 md:py-16 space-y-8">
        {/* Corner brackets — FUI signature treatment */}
        <span className="absolute top-4 left-4 w-4 h-4 border-t-2 border-l-2 border-accent/70 pointer-events-none" />
        <span className="absolute top-4 right-4 w-4 h-4 border-t-2 border-r-2 border-accent/70 pointer-events-none" />
        <span className="absolute bottom-4 left-4 w-4 h-4 border-b-2 border-l-2 border-accent/70 pointer-events-none" />
        <span className="absolute bottom-4 right-4 w-4 h-4 border-b-2 border-r-2 border-accent/70 pointer-events-none" />

        {/* 1 — Header celebration */}
        <header className="text-center space-y-3">
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            className="inline-flex items-center justify-center w-16 h-16 border-2 border-accent text-accent shadow-[0_0_24px_-4px_rgba(0,255,136,0.55)]"
          >
            <Trophy className="w-8 h-8" />
          </motion.div>
          <h1
            className="font-display font-bold uppercase text-3xl md:text-4xl text-accent"
            style={{ textShadow: '0 0 18px rgba(0, 255, 136, 0.35)' }}
          >
            Workout Complete
          </h1>
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {day.name}
            {formattedDate && <span className="mx-2 opacity-50">·</span>}
            {formattedDate}
          </p>
        </header>

        {/* 2 — Three big-number stats */}
        <motion.section
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
          }}
          className="grid grid-cols-3 gap-3"
          data-testid="workout-summary-stats"
        >
          <StatTile label="Sets logged" value={String(stats.setsLogged)} />
          <StatTile
            label="Volume"
            value={stats.totalVolume > 0 ? `${formatNumber(stats.totalVolume)} kg` : '—'}
          />
          <StatTile
            label="Avg RPE"
            value={stats.avgRpe === null ? '—' : stats.avgRpe.toFixed(1)}
          />
        </motion.section>

        {/* 3 — PR callouts */}
        {visiblePRs.length > 0 && (
          <section className="space-y-2" data-testid="workout-summary-prs">
            {visiblePRs.map((pr, i) => (
              <motion.div
                key={pr.exerciseName + i}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: 0.25 + i * 0.08 }}
                className="border border-warning/40 bg-warning/5 p-3 flex items-center gap-2"
              >
                <Trophy className="w-4 h-4 text-warning" />
                <span className="font-display font-bold uppercase text-sm text-warning">
                  New PR: {pr.exerciseName} — {pr.e1rm}kg
                </span>
              </motion.div>
            ))}
            {extraPRs > 0 && (
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70 pl-1">
                + {extraPRs} more PR{extraPRs === 1 ? '' : 's'}
              </p>
            )}
          </section>
        )}

        {/* 4 — vs previous session */}
        {comparison && (
          <section
            className="border border-primary/20 bg-surface/50 p-4 space-y-2"
            data-testid="workout-summary-comparison"
          >
            <p className="font-mono text-[10px] uppercase tracking-widest text-primary/60">
              vs Previous {day.name}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <DeltaRow
                label="Volume"
                value={comparison.volumeDelta}
                unit="kg"
                higherIsBetter
              />
              <DeltaRow
                label="Avg RPE"
                value={comparison.rpeDelta}
                unit=""
                higherIsBetter={false}
              />
            </div>
          </section>
        )}

        {/* 5 — Actions */}
        <div className="space-y-2 pt-2">
          <Button
            variant="primary"
            className="w-full py-3"
            onClick={onSubmitReflection}
            data-testid="summary-submit-reflection-btn"
          >
            Submit Reflection
          </Button>
          <Button
            variant="ghost"
            className="w-full py-3"
            onClick={onClose}
            data-testid="summary-close-btn"
          >
            Close Without Reflection
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <TechnicalCard className="border-accent/30 shadow-[0_0_16px_-6px_rgba(0,255,136,0.4)]">
        <div className="px-3 py-4 text-center">
          <p className="font-display font-bold text-3xl md:text-4xl text-primary tabular-nums leading-none">
            {value}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-2">
            {label}
          </p>
        </div>
      </TechnicalCard>
    </motion.div>
  );
}

function DeltaRow({
  label,
  value,
  unit,
  higherIsBetter,
}: {
  label: string;
  value: number | null;
  unit: string;
  higherIsBetter: boolean;
}) {
  if (value === null) {
    return (
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">—</span>
      </div>
    );
  }
  const positive = value > 0;
  const negative = value < 0;
  // For RPE the colour semantics flip — lower RPE for similar work is the
  // good signal. The `higherIsBetter` flag captures that.
  const good = (positive && higherIsBetter) || (negative && !higherIsBetter);
  const bad = (negative && higherIsBetter) || (positive && !higherIsBetter);
  const tone = good ? 'text-accent' : bad ? 'text-warning' : 'text-muted-foreground';
  const Arrow = good ? TrendingUp : bad ? TrendingDown : null;
  const sign = positive ? '+' : '';
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={cn('flex items-center gap-1 font-mono text-xs tabular-nums', tone)}>
        {Arrow && <Arrow className="w-3 h-3" />}
        {sign}{value}{unit && ` ${unit}`}
      </span>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function parseRepsNumeric(reps: string | number | undefined): number | null {
  if (reps == null) return null;
  if (typeof reps === 'number') return reps > 0 ? reps : null;
  const m = reps.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return n > 0 ? n : null;
}

function maxSetIndex(ex: ExercisePlan): number {
  const declared = typeof ex.sets === 'number' && ex.sets > 0 ? Math.min(ex.sets, 20) : 1;
  // Honour per-set keys that extend past the declared `sets` count — rare
  // but possible if the trainee added an extra set inline.
  let highest = declared;
  for (const key of Object.keys(ex.values ?? {})) {
    const m = key.match(/^set_(\d+)_/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > highest) highest = n;
    }
  }
  return Math.min(highest, 20);
}

/** Today's best e1RM across all sets of an exercise within the given day. */
function bestE1RMForExercise(day: WorkoutDay, exerciseId: string): number | null {
  let best: number | null = null;
  for (const ex of day.exercises) {
    if (ex.exerciseId !== exerciseId) continue;
    const sets = getLoadedSets(ex);
    for (const s of sets) {
      const e = estimate1RM(s.load, s.reps);
      if (e === null) continue;
      if (best === null || e > best) best = e;
    }
  }
  return best;
}

/**
 * Find the most recent prior logged day in the same program with the same
 * dayNumber. Used for the "vs previous session" comparison. Skips today
 * (matched by loggedAt) so the comparison isn't self-referential.
 */
function findPriorSameDay(program: Program, today: WorkoutDay): WorkoutDay | null {
  let best: WorkoutDay | null = null;
  let bestAt = '';
  for (const week of program.weeks) {
    for (const d of week.days) {
      if (d.dayNumber !== today.dayNumber) continue;
      if (!d.loggedAt) continue;
      if (d.id === today.id) continue;
      if (today.loggedAt && d.loggedAt >= today.loggedAt) continue;
      if (d.loggedAt > bestAt) {
        bestAt = d.loggedAt;
        best = d;
      }
    }
  }
  return best;
}

/** Same maths as the top-of-file stats memo but for a different day. */
function computeSessionStats(day: WorkoutDay): { totalVolume: number; avgRpe: number | null } {
  let totalVolume = 0;
  const rpeValues: number[] = [];
  for (const ex of day.exercises) {
    const repCount = parseRepsNumeric(ex.reps);
    for (let n = 1; n <= maxSetIndex(ex); n += 1) {
      const load = parseFloat(ex.values?.[`set_${n}_load`] ?? '');
      const rpe = parseFloat(ex.values?.[`set_${n}_rpe`] ?? '');
      if (Number.isFinite(load) && load > 0 && repCount !== null) totalVolume += load * repCount;
      if (Number.isFinite(rpe) && rpe > 0) rpeValues.push(rpe);
    }
    if (
      !ex.values?.set_1_load
      && ex.actualLoad
      && Number.isFinite(parseFloat(ex.actualLoad))
      && repCount !== null
    ) {
      const v = parseFloat(ex.actualLoad);
      if (v > 0) totalVolume += v * repCount;
    }
  }
  const avgRpe = rpeValues.length === 0
    ? null
    : Math.round((rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length) * 10) / 10;
  return { totalVolume: Math.round(totalVolume * 10) / 10, avgRpe };
}

function formatNumber(n: number): string {
  // Short-form for volumes: 12,450 stays as "12450" up to 4 digits, "12.4k"
  // for 5+. Keeps the stat tile from wrapping on phones.
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
