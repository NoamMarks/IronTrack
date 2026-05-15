import { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  Sparkles,
  AlertCircle,
  BarChart3,
  Award,
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
  ReferenceLine,
} from 'recharts';
import { TechnicalCard, Button } from '../ui';
import { BodyWeightLog } from './BodyWeightLog';
import { cn } from '../../lib/utils';
import {
  aggregateE1RM,
  aggregateVolume,
  listLoggedExercises,
  personalRecord,
} from '../../lib/analytics';
import { calculatePoints, strengthTier, type Gender } from '../../lib/formulas';
import { supabase } from '../../lib/supabase';
import type { Client } from '../../types';

interface AnalyticsDashboardProps {
  client: Client;
}

type View = 'e1rm' | 'volume' | 'dots';

const DOTS_PREFS_KEY = 'irontrack_dots_prefs';

interface DotsPrefs {
  sex: Gender;
  bodyweight: number;
}

function loadDotsPrefs(): DotsPrefs {
  if (typeof window === 'undefined') return { sex: 'male', bodyweight: 80 };
  try {
    const raw = window.localStorage.getItem(DOTS_PREFS_KEY);
    if (!raw) return { sex: 'male', bodyweight: 80 };
    const parsed = JSON.parse(raw) as Partial<DotsPrefs>;
    return {
      sex: parsed.sex === 'female' ? 'female' : 'male',
      bodyweight:
        typeof parsed.bodyweight === 'number' && parsed.bodyweight > 0
          ? parsed.bodyweight
          : 80,
    };
  } catch {
    return { sex: 'male', bodyweight: 80 };
  }
}

function saveDotsPrefs(prefs: DotsPrefs) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DOTS_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* localStorage full / disabled — preference simply doesn't persist */
  }
}

export function AnalyticsDashboard({ client }: AnalyticsDashboardProps) {
  const exercises = useMemo(() => listLoggedExercises(client), [client]);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>(
    exercises[0]?.id ?? ''
  );
  const [view, setView] = useState<View>('e1rm');

  // Auto-select the first exercise once data arrives, or when the current
  // selection no longer exists (e.g. last logged session for that exercise was deleted).
  useEffect(() => {
    if (exercises.length === 0) return;
    const stillExists = exercises.some((e) => e.id === selectedExerciseId);
    if (!stillExists) setSelectedExerciseId(exercises[0].id);
  }, [exercises, selectedExerciseId]);

  // ─── Series data ────────────────────────────────────────────────────────
  const e1rmData = useMemo(
    () => (selectedExerciseId ? aggregateE1RM(client, selectedExerciseId) : []),
    [client, selectedExerciseId]
  );
  const volumeData = useMemo(
    () => (selectedExerciseId ? aggregateVolume(client, selectedExerciseId) : []),
    [client, selectedExerciseId]
  );

  const pr = useMemo(
    () => (selectedExerciseId ? personalRecord(client, selectedExerciseId) : null),
    [client, selectedExerciseId]
  );

  // ─── DOTS preferences ──────────────────────────────────────────────────
  // Sex + bodyweight are personal data that the trainee shouldn't have to
  // re-enter every visit. We persist to localStorage rather than the
  // Supabase profile so the schema stays unchanged for now — proper
  // bodyweight history (which would unlock real DOTS-over-time) is a
  // bigger schema discussion saved for later.
  const [dotsPrefs, setDotsPrefs] = useState<DotsPrefs>(() => loadDotsPrefs());
  const [bodyweightInput, setBodyweightInput] = useState<string>(() =>
    String(loadDotsPrefs().bodyweight),
  );

  useEffect(() => {
    saveDotsPrefs(dotsPrefs);
  }, [dotsPrefs]);

  // ─── Exercise goals ─────────────────────────────────────────────────────
  // Per-exercise target e1RM, surfaced as a horizontal reference line on the
  // e1RM chart. Loaded once per client and kept in a flat
  // exerciseId → kg lookup so the chart can read it in O(1).
  const [goals, setGoals] = useState<Record<string, number>>({});
  const [goalInput, setGoalInput] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);

  useEffect(() => {
    void supabase
      .from('exercise_goals')
      .select('exercise_id, target_e1rm')
      .eq('client_id', client.id)
      .then(({ data }) => {
        if (data) {
          setGoals(
            Object.fromEntries(
              data.map((g) => [g.exercise_id as string, Number(g.target_e1rm)]),
            ),
          );
        }
      });
  }, [client.id]);

  // Reset the input when the user switches exercises so a half-typed value
  // for one lift doesn't bleed across to another.
  useEffect(() => { setGoalInput(''); }, [selectedExerciseId]);

  const saveGoal = async (exerciseId: string, value: number) => {
    setSavingGoal(true);
    try {
      const { error } = await supabase.from('exercise_goals').upsert({
        client_id: client.id,
        exercise_id: exerciseId,
        target_e1rm: value,
      }, { onConflict: 'client_id,exercise_id' });
      if (error) throw error;
      setGoals((prev) => ({ ...prev, [exerciseId]: value }));
    } catch (err) {
      console.error('[IronTrack] saveGoal failed', err);
    } finally {
      setSavingGoal(false);
    }
  };

  // Derive a DOTS-scored series from the e1RM trend. We treat the trainee's
  // current bodyweight as constant across history — it's an approximation,
  // but matches what every powerlifting comparison site does when bodyweight
  // history isn't available. The UI explicitly labels this.
  const dotsData = useMemo(() => {
    return e1rmData
      .map((p) => {
        const score = calculatePoints(dotsPrefs.bodyweight, p.e1rm, dotsPrefs.sex, 'dots');
        return score === null ? null : { date: p.date, score, e1rm: p.e1rm };
      })
      .filter((p): p is { date: string; score: number; e1rm: number } => p !== null);
  }, [e1rmData, dotsPrefs]);

  // ─── Stats per view ─────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (view === 'volume') {
      type VolumeRow = (typeof volumeData)[number];
      const latest: VolumeRow | null = volumeData[volumeData.length - 1] ?? null;
      const previous: VolumeRow | null =
        volumeData.length > 1 ? volumeData[volumeData.length - 2] : null;
      const best = volumeData.reduce<VolumeRow | null>(
        (acc, p) => (acc === null || p.volume > acc.volume ? p : acc),
        null as VolumeRow | null,
      );
      const delta =
        latest && previous
          ? Math.round((latest.volume - previous.volume) * 10) / 10
          : null;
      return { latest, previous, best, delta, kind: 'volume' as const };
    }
    if (view === 'dots') {
      type DotsRow = (typeof dotsData)[number];
      const latest: DotsRow | null = dotsData[dotsData.length - 1] ?? null;
      const previous: DotsRow | null =
        dotsData.length > 1 ? dotsData[dotsData.length - 2] : null;
      const best = dotsData.reduce<DotsRow | null>(
        (acc, p) => (acc === null || p.score > acc.score ? p : acc),
        null as DotsRow | null,
      );
      const delta =
        latest && previous
          ? Math.round((latest.score - previous.score) * 10) / 10
          : null;
      return { latest, previous, best, delta, kind: 'dots' as const };
    }
    const latest = e1rmData[e1rmData.length - 1] ?? null;
    const previous = e1rmData.length > 1 ? e1rmData[e1rmData.length - 2] : null;
    const delta =
      latest && previous
        ? Math.round((latest.e1rm - previous.e1rm) * 10) / 10
        : null;
    return { latest, previous, pr, delta, kind: 'e1rm' as const };
  }, [view, e1rmData, volumeData, dotsData, pr]);

  const activeData =
    view === 'volume' ? volumeData : view === 'dots' ? dotsData : e1rmData;

  return (
    <div className="space-y-10" data-testid="analytics-dashboard">
      <TechnicalCard>
        <div className="p-8 space-y-6">
          {/* ── Header: title + view toggle + exercise selector ─────────── */}
          <div className="flex flex-col xl:flex-row xl:justify-between xl:items-start gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-foreground text-background flex items-center justify-center rounded-sm">
                {view === 'e1rm' && <TrendingUp className="w-6 h-6" />}
                {view === 'volume' && <BarChart3 className="w-6 h-6" />}
                {view === 'dots' && <Award className="w-6 h-6" />}
              </div>
              <div>
                <h3 className="text-2xl font-bold italic font-serif tracking-tight">
                  {view === 'e1rm' && 'Estimated 1RM'}
                  {view === 'volume' && 'Total Tonnage'}
                  {view === 'dots' && 'DOTS Strength Tier'}
                </h3>
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mt-1">
                  {view === 'e1rm' && 'Epley Formula · Performance Trend'}
                  {view === 'volume' && 'Σ (load × reps) per session · Work Trend'}
                  {view === 'dots' && 'Bodyweight-Adjusted · Tier Trend'}
                </p>
              </div>
            </div>

            {/* View toggle */}
            <div className="flex gap-px bg-border" data-testid="analytics-view-toggle">
              {(['e1rm', 'volume', 'dots'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  data-testid={`analytics-view-${v}`}
                  aria-pressed={view === v}
                  className={cn(
                    'px-4 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors',
                    view === v
                      ? 'bg-primary/20 text-primary border-b-2 border-primary'
                      : 'bg-surface text-muted-foreground hover:text-primary',
                  )}
                >
                  {v === 'e1rm' ? '1RM' : v === 'volume' ? 'Volume' : 'DOTS'}
                </button>
              ))}
            </div>
          </div>

          {/* Exercise selector */}
          {exercises.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {exercises.map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => setSelectedExerciseId(ex.id)}
                  data-testid={`exercise-tab-${ex.id}`}
                  className={cn(
                    'px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border transition-all',
                    selectedExerciseId === ex.id
                      ? 'bg-primary/20 text-primary border-primary'
                      : 'border-border/50 text-muted-foreground hover:border-primary hover:text-primary'
                  )}
                >
                  {ex.name}
                </button>
              ))}
            </div>
          )}

          {/* DOTS controls — only shown in DOTS view */}
          {view === 'dots' && (
            <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-3 items-end p-4 border border-primary/20 bg-surface/50">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                  Class
                </label>
                <div className="flex gap-px bg-border">
                  {(['male', 'female'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setDotsPrefs((p) => ({ ...p, sex: s }))}
                      data-testid={`dots-sex-${s === 'male' ? 'M' : 'F'}`}
                      aria-pressed={dotsPrefs.sex === s}
                      className={cn(
                        'px-4 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors',
                        dotsPrefs.sex === s
                          ? 'bg-primary/20 text-primary'
                          : 'bg-surface text-muted-foreground hover:text-primary',
                      )}
                    >
                      {s === 'male' ? 'Men' : 'Women'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                  Current bodyweight (kg)
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-surface p-3 border-b border-primary/30">
                    <input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9.]*"
                      value={bodyweightInput}
                      onChange={(e) => setBodyweightInput(e.target.value.replace(/[^0-9.]/g, ''))}
                      onBlur={() => {
                        const n = Number(bodyweightInput);
                        const clamped = Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, 30), 250) : 80;
                        setBodyweightInput(String(clamped));
                        setDotsPrefs((p) => ({ ...p, bodyweight: clamped }));
                      }}
                      data-testid="dots-bodyweight"
                      className="bg-transparent border-none outline-none focus:ring-0 text-foreground font-mono text-sm w-full text-center"
                    />
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground/80 max-w-xs">
                    Scaled to your current bodyweight across the entire trend.
                  </p>
                </div>
              </div>
            </div>
          )}

          {view === 'dots' && (
            <div className="mt-4">
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/60 mb-2">Weight History</p>
              <BodyWeightLog clientId={client.id} />
            </div>
          )}

          {/* Stat strip — adapts per view */}
          {activeData.length > 0 && stats.kind === 'e1rm' && (
            <div data-testid="e1rm-stat-strip" className="grid grid-cols-3 gap-3">
              <StatCell
                icon={<Trophy className="w-3.5 h-3.5" />}
                label="Personal best"
                primary={stats.pr ? `${stats.pr.e1rm} kg` : '—'}
                secondary={stats.pr ? `${stats.pr.load} kg × ${stats.pr.reps} · ${stats.pr.date}` : 'No PR yet'}
                tone="amber"
                testId="stat-pr"
              />
              <StatCell
                icon={<Sparkles className="w-3.5 h-3.5" />}
                label="Latest e1RM"
                primary={stats.latest ? `${stats.latest.e1rm} kg` : '—'}
                secondary={stats.latest ? stats.latest.date : 'No data'}
                tone="emerald"
                testId="stat-latest"
              />
              <StatCell
                icon={deltaIcon(stats.delta)}
                label="vs previous"
                primary={formatDelta(stats.delta, 'kg')}
                secondary={
                  stats.previous ? `was ${stats.previous.e1rm} kg · ${stats.previous.date}` : 'First session'
                }
                tone={deltaTone(stats.delta)}
                testId="stat-delta"
              />
            </div>
          )}

          {activeData.length > 0 && stats.kind === 'volume' && (
            <div data-testid="volume-stat-strip" className="grid grid-cols-3 gap-3">
              <StatCell
                icon={<Trophy className="w-3.5 h-3.5" />}
                label="Best session"
                primary={stats.best ? `${stats.best.volume} kg` : '—'}
                secondary={stats.best ? stats.best.date : 'No data'}
                tone="amber"
                testId="stat-best-volume"
              />
              <StatCell
                icon={<Sparkles className="w-3.5 h-3.5" />}
                label="Latest tonnage"
                primary={stats.latest ? `${stats.latest.volume} kg` : '—'}
                secondary={stats.latest ? stats.latest.date : 'No data'}
                tone="emerald"
                testId="stat-latest-volume"
              />
              <StatCell
                icon={deltaIcon(stats.delta)}
                label="vs previous"
                primary={formatDelta(stats.delta, 'kg')}
                secondary={
                  stats.previous ? `was ${stats.previous.volume} kg · ${stats.previous.date}` : 'First session'
                }
                tone={deltaTone(stats.delta)}
                testId="stat-delta-volume"
              />
            </div>
          )}

          {activeData.length > 0 && stats.kind === 'dots' && (
            <div data-testid="dots-stat-strip" className="grid grid-cols-3 gap-3">
              <StatCell
                icon={<Trophy className="w-3.5 h-3.5" />}
                label="Best DOTS"
                primary={stats.best ? String(stats.best.score) : '—'}
                secondary={stats.best ? `${stats.best.e1rm} kg · ${stats.best.date}` : 'No data'}
                tone="amber"
                testId="stat-best-dots"
              />
              <StatCell
                icon={<Sparkles className="w-3.5 h-3.5" />}
                label="Latest DOTS"
                primary={stats.latest ? String(stats.latest.score) : '—'}
                secondary={(() => {
                  const tier = strengthTier(stats.latest?.score ?? null);
                  return tier ? `Tier · ${tier.label}` : 'No data';
                })()}
                tone="emerald"
                testId="stat-latest-dots"
              />
              <StatCell
                icon={deltaIcon(stats.delta)}
                label="vs previous"
                primary={formatDelta(stats.delta, '')}
                secondary={
                  stats.previous ? `was ${stats.previous.score} · ${stats.previous.date}` : 'First session'
                }
                tone={deltaTone(stats.delta)}
                testId="stat-delta-dots"
              />
            </div>
          )}

          {/* Goal-setting row — only meaningful in the e1RM view, and only
              when the trainee has picked an exercise (otherwise saveGoal
              has nothing to scope to). */}
          {view === 'e1rm' && selectedExerciseId && (
            <div className="flex items-center gap-3 py-3 border-y border-primary/15">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground shrink-0">
                Target e1RM
              </span>
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={goalInput || (goals[selectedExerciseId] ? String(goals[selectedExerciseId]) : '')}
                  onChange={(e) => setGoalInput(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="Set goal (kg)"
                  data-testid="goal-input"
                  className="w-32 bg-surface border-b border-primary/30 focus:border-primary p-2 font-mono text-sm text-foreground outline-none"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!goalInput || savingGoal}
                  data-testid="goal-save-btn"
                  onClick={() => {
                    const v = parseFloat(goalInput);
                    if (v > 0) {
                      void saveGoal(selectedExerciseId, v);
                      setGoalInput('');
                    }
                  }}
                >
                  {savingGoal ? 'Saving…' : 'Set Goal'}
                </Button>
                {goals[selectedExerciseId] && (
                  <span
                    data-testid="goal-current"
                    className="text-[10px] font-mono text-primary/70 uppercase tracking-widest"
                  >
                    Current goal: {goals[selectedExerciseId]} kg
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Chart */}
          {activeData.length === 0 ? (
            <EmptyChart
              message={
                view === 'e1rm'
                  ? 'No logged actuals yet — log a session to see your e1RM trend.'
                  : view === 'volume'
                    ? 'No tonnage data yet — log loaded sets to see your volume trend.'
                    : 'No DOTS data yet — log loaded sets to see your strength tier trend.'
              }
            />
          ) : view === 'volume' ? (
            <VolumeChart data={volumeData} />
          ) : view === 'dots' ? (
            <DotsChart data={dotsData} />
          ) : (
            <E1rmChart data={e1rmData} goalE1rm={goals[selectedExerciseId]} />
          )}
        </div>
      </TechnicalCard>
    </div>
  );
}

// ─── Charts ────────────────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  backgroundColor: '#0A1628',
  border: '1px solid rgba(0, 212, 255, 0.2)',
  borderRadius: '0px',
  fontSize: '11px',
  fontFamily: 'JetBrains Mono, monospace',
  color: '#E2F4FF',
} as const;

function E1rmChart({
  data,
  goalE1rm,
}: {
  data: ReturnType<typeof aggregateE1RM>;
  goalE1rm?: number;
}) {
  return (
    <div className="h-72" data-testid="e1rm-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="e1rmGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00FF88" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#00FF88" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
          <XAxis dataKey="date" stroke="currentColor" fontSize={10} fontFamily="monospace" opacity={0.6} />
          <YAxis stroke="currentColor" fontSize={10} fontFamily="monospace" opacity={0.6} unit="kg" />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Area
            type="monotone"
            dataKey="e1rm"
            name="e1RM (kg)"
            stroke="#00FF88"
            strokeWidth={2}
            fill="url(#e1rmGradient)"
            dot={{ fill: '#00FF88', r: 4 }}
            activeDot={{ r: 6 }}
          />
          {goalE1rm && (
            <ReferenceLine
              y={goalE1rm}
              ifOverflow="extendDomain"
              stroke="rgba(0,255,136,0.6)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: `Goal ${goalE1rm}kg`,
                position: 'insideTopRight',
                fontSize: 10,
                fontFamily: 'monospace',
                fill: 'rgba(0,255,136,0.7)',
              }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function VolumeChart({ data }: { data: ReturnType<typeof aggregateVolume> }) {
  return (
    <div className="h-72" data-testid="volume-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00D4FF" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#00D4FF" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
          <XAxis dataKey="date" stroke="currentColor" fontSize={10} fontFamily="monospace" opacity={0.6} />
          <YAxis stroke="currentColor" fontSize={10} fontFamily="monospace" opacity={0.6} unit="kg" />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Area
            type="monotone"
            dataKey="volume"
            name="Tonnage (kg)"
            stroke="#00D4FF"
            strokeWidth={2}
            fill="url(#volumeGradient)"
            dot={{ fill: '#00D4FF', r: 4 }}
            activeDot={{ r: 6 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function DotsChart({ data }: { data: Array<{ date: string; score: number }> }) {
  // Reference lines at the tier thresholds give the user immediate context
  // for what their score "means" without forcing them to memorise the bands.
  return (
    <div className="h-72" data-testid="dots-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="dotsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFB300" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#FFB300" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
          <XAxis dataKey="date" stroke="currentColor" fontSize={10} fontFamily="monospace" opacity={0.6} />
          <YAxis stroke="currentColor" fontSize={10} fontFamily="monospace" opacity={0.6} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Area
            type="monotone"
            dataKey="score"
            name="DOTS"
            stroke="#FFB300"
            strokeWidth={2}
            fill="url(#dotsGradient)"
            dot={{ fill: '#FFB300', r: 4 }}
            activeDot={{ r: 6 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Stat helpers ──────────────────────────────────────────────────────────

function deltaIcon(delta: number | null): React.ReactNode {
  if (delta == null) return <Minus className="w-3.5 h-3.5" />;
  if (delta > 0) return <TrendingUp className="w-3.5 h-3.5" />;
  if (delta < 0) return <TrendingDown className="w-3.5 h-3.5" />;
  return <Minus className="w-3.5 h-3.5" />;
}

function deltaTone(delta: number | null): 'emerald' | 'amber' | 'muted' {
  if (delta == null) return 'muted';
  if (delta > 0) return 'emerald';
  if (delta < 0) return 'amber';
  return 'muted';
}

function formatDelta(delta: number | null, unit: string): string {
  if (delta == null) return '—';
  if (delta === 0) return 'same';
  const suffix = unit ? ` ${unit}` : '';
  return delta > 0 ? `+${delta}${suffix}` : `${delta}${suffix}`;
}

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
      ? 'border-accent/30 bg-accent/[0.06]'
      : tone === 'amber'
        ? 'border-warning/30 bg-warning/[0.06]'
        : 'border-border/50 bg-muted/20';
  const accent =
    tone === 'emerald'
      ? 'text-accent'
      : tone === 'amber'
        ? 'text-warning'
        : 'text-muted-foreground';
  return (
    <div
      data-testid={testId}
      className={cn(
        'border p-3 md:p-4 flex flex-col gap-1',
        ring,
      )}
    >
      <div className={cn('flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em]', accent)}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg md:text-xl font-mono font-bold tabular-nums tracking-tight text-foreground">
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
      <div className="w-10 h-10 border border-border/50 flex items-center justify-center mb-3">
        <AlertCircle className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-xs font-mono text-muted-foreground max-w-sm">{message}</p>
    </motion.div>
  );
}

