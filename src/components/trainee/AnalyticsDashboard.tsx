import { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { TechnicalCard } from '../ui';
import { cn } from '../../lib/utils';
import { aggregateE1RM, listLoggedExercises, personalRecord } from '../../lib/analytics';
import type { Client } from '../../types';

interface AnalyticsDashboardProps {
  client: Client;
}

export function AnalyticsDashboard({ client }: AnalyticsDashboardProps) {
  const exercises = useMemo(() => listLoggedExercises(client), [client]);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>(
    exercises[0]?.id ?? ''
  );

  // Auto-select the first exercise once data arrives, or when the current
  // selection no longer exists (e.g. last logged session for that exercise was deleted).
  useEffect(() => {
    if (exercises.length === 0) return;
    const stillExists = exercises.some((e) => e.id === selectedExerciseId);
    if (!stillExists) setSelectedExerciseId(exercises[0].id);
  }, [exercises, selectedExerciseId]);

  const e1rmData = useMemo(
    () => (selectedExerciseId ? aggregateE1RM(client, selectedExerciseId) : []),
    [client, selectedExerciseId]
  );

  // Stat strip data — three at-a-glance numbers above the chart so the user
  // doesn't have to eyeball the line to know where they're at:
  //   - PR: highest e1RM ever (date-stamped via `personalRecord`)
  //   - Latest: the most recent session's e1RM
  //   - Δ: latest minus the one before it (the "did I push past last session"
  //        signal, which is a tighter read than a rolling chart)
  const pr = useMemo(
    () => (selectedExerciseId ? personalRecord(client, selectedExerciseId) : null),
    [client, selectedExerciseId]
  );
  const latestE1rm = e1rmData.length > 0 ? e1rmData[e1rmData.length - 1] : null;
  const previousE1rm = e1rmData.length > 1 ? e1rmData[e1rmData.length - 2] : null;
  const sessionDelta =
    latestE1rm && previousE1rm
      ? Math.round((latestE1rm.e1rm - previousE1rm.e1rm) * 10) / 10
      : null;

  return (
    <div className="space-y-10" data-testid="analytics-dashboard">
      {/* ── Chart A: Performance / e1RM ───────────────────────────────── */}
      <TechnicalCard>
        <div className="p-8 space-y-6">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-foreground text-background flex items-center justify-center rounded-sm">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-2xl font-bold italic font-serif tracking-tight">
                  Estimated 1RM
                </h3>
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mt-1">
                  Epley Formula · Performance Trend
                </p>
              </div>
            </div>

            {/* Exercise selector */}
            {exercises.length > 0 && (
              <div className="flex flex-wrap gap-2 max-w-md justify-end">
                {exercises.map((ex) => (
                  <button
                    key={ex.id}
                    onClick={() => setSelectedExerciseId(ex.id)}
                    data-testid={`exercise-tab-${ex.id}`}
                    className={cn(
                      'px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border transition-all',
                      selectedExerciseId === ex.id
                        ? 'bg-foreground text-background border-foreground'
                        : 'border-border text-muted-foreground hover:border-muted-foreground'
                    )}
                  >
                    {ex.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Stat strip — only renders when we have at least one session.
              Hides cleanly on first-load empty state. */}
          {e1rmData.length > 0 && (
            <div
              data-testid="e1rm-stat-strip"
              className="grid grid-cols-3 gap-3"
            >
              <StatCell
                icon={<Trophy className="w-3.5 h-3.5" />}
                label="Personal best"
                primary={pr ? `${pr.e1rm} kg` : '—'}
                secondary={pr ? `${pr.load} kg × ${pr.reps} · ${pr.date}` : 'No PR yet'}
                tone="amber"
                testId="stat-pr"
              />
              <StatCell
                icon={<Sparkles className="w-3.5 h-3.5" />}
                label="Latest e1RM"
                primary={latestE1rm ? `${latestE1rm.e1rm} kg` : '—'}
                secondary={latestE1rm ? latestE1rm.date : 'No data'}
                tone="emerald"
                testId="stat-latest"
              />
              <StatCell
                icon={
                  sessionDelta == null ? (
                    <Minus className="w-3.5 h-3.5" />
                  ) : sessionDelta > 0 ? (
                    <TrendingUp className="w-3.5 h-3.5" />
                  ) : sessionDelta < 0 ? (
                    <TrendingDown className="w-3.5 h-3.5" />
                  ) : (
                    <Minus className="w-3.5 h-3.5" />
                  )
                }
                label="vs previous"
                primary={
                  sessionDelta == null
                    ? '—'
                    : sessionDelta > 0
                      ? `+${sessionDelta} kg`
                      : sessionDelta < 0
                        ? `${sessionDelta} kg`
                        : 'same'
                }
                secondary={
                  previousE1rm ? `was ${previousE1rm.e1rm} kg · ${previousE1rm.date}` : 'First session'
                }
                tone={
                  sessionDelta == null
                    ? 'muted'
                    : sessionDelta > 0
                      ? 'emerald'
                      : sessionDelta < 0
                        ? 'amber'
                        : 'muted'
                }
                testId="stat-delta"
              />
            </div>
          )}

          {e1rmData.length === 0 ? (
            <EmptyChart message="No logged actuals yet — log a session to see your e1RM trend." />
          ) : (
            <div className="h-72" data-testid="e1rm-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={e1rmData} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="e1rmGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                  <XAxis dataKey="date" stroke="currentColor" fontSize={10} fontFamily="monospace" opacity={0.6} />
                  <YAxis stroke="currentColor" fontSize={10} fontFamily="monospace" opacity={0.6} unit="kg" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '2px',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="e1rm"
                    name="e1RM (kg)"
                    stroke="#22c55e"
                    strokeWidth={2}
                    fill="url(#e1rmGradient)"
                    dot={{ fill: '#22c55e', r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </TechnicalCard>

    </div>
  );
}

/**
 * Compact stat tile for the strip above the chart. Three of these read in
 * a glance: PR / latest / delta — answering "where am I now" without
 * decoding the line.
 */
function StatCell({
  icon,
  label,
  primary,
  secondary,
  tone,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  primary: string;
  secondary: string;
  tone: 'emerald' | 'amber' | 'muted';
  testId: string;
}) {
  const ring =
    tone === 'emerald'
      ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
      : tone === 'amber'
        ? 'border-amber-500/30 bg-amber-500/[0.06]'
        : 'border-border/50 bg-muted/20';
  const accent =
    tone === 'emerald'
      ? 'text-emerald-300'
      : tone === 'amber'
        ? 'text-amber-300'
        : 'text-muted-foreground';
  return (
    <div
      data-testid={testId}
      className={cn(
        'rounded-xl border p-3 md:p-4 flex flex-col gap-1',
        ring,
      )}
    >
      <div className={cn('flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em]', accent)}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg md:text-xl font-bold tabular-nums tracking-tight text-foreground">
        {primary}
      </div>
      <div className="text-[10px] font-mono text-muted-foreground/70 truncate" title={secondary}>
        {secondary}
      </div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="empty-chart"
    >
      <AlertCircle className="w-8 h-8 text-muted-foreground mb-3" />
      <p className="text-xs font-mono text-muted-foreground max-w-sm">{message}</p>
    </motion.div>
  );
}