import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Trophy,
  Upload,
  Play,
  Calculator,
  Check,
  Flame,
  StickyNote,
  Cloud,
  CloudOff,
  Loader2,
  History,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TechnicalCard } from '../ui';
import { cn } from '../../lib/utils';
import { DEFAULT_COLUMNS } from '../../constants/mockData';
import { PlateCalculator } from './PlateCalculator';
import { hapticTick, hapticHeavy } from '../../lib/haptics';
import { sanitizeOnType, clampOnCommit, parseNumeric } from '../../lib/numericInput';
import {
  findPreviousWeekExercise,
  getPreviousSetLoad,
  getPreviousSetRpe,
} from '../../lib/progressiveOverload';
import { rpeAutoregulationSuggestion } from '../../lib/analytics';
import type { Client, Program, WorkoutWeek, WorkoutDay, ExercisePlan, ProgramColumn } from '../../types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getExerciseValue(ex: ExercisePlan, colId: string): string | number | undefined {
  if (colId === 'sets')        return ex.sets;
  if (colId === 'reps')        return ex.reps;
  if (colId === 'expectedRpe') return ex.expectedRpe;
  if (colId === 'weightRange') return ex.weightRange;
  if (colId === 'actualLoad')  return ex.actualLoad;
  if (colId === 'actualRpe')   return ex.actualRpe;
  if (colId === 'notes')       return ex.notes;
  return ex.values?.[colId] ?? '';
}

const COMPLETED_KEY = '__completed';
function isCompleted(ex: ExercisePlan): boolean {
  return ex.values?.[COMPLETED_KEY] === '1';
}

/** Compact one-line plan, kept as a single string so existing tests
 *  asserting `plan-summary-N` text content continue to pass. The visual
 *  styling (chip-like presentation) is layered on top via flex + tracking
 *  rather than splitting the string into separate spans. */
function buildPlanSummary(ex: ExercisePlan, columns: ProgramColumn[]): string {
  const planCols = columns.filter((c) => c.type === 'plan');
  const get = (id: string): string => {
    const v = getExerciseValue(ex, id);
    if (v == null) return '';
    const s = String(v).trim();
    return s.length > 0 ? s : '';
  };
  const sets = get('sets');
  const reps = get('reps');
  const rpe = get('expectedRpe');
  const range = get('weightRange');

  const parts: string[] = [];
  if (sets && reps) parts.push(`${sets} × ${reps}`);
  else if (sets) parts.push(`${sets} sets`);
  else if (reps) parts.push(`${reps} reps`);
  if (rpe) parts.push(`@ RPE ${rpe}`);
  if (range) parts.push(`(${range})`);

  for (const col of planCols) {
    if (['sets', 'reps', 'expectedRpe', 'weightRange'].includes(col.id)) continue;
    const v = get(col.id);
    if (v) parts.push(`${col.label}: ${v}`);
  }

  return parts.length > 0 ? parts.join(' ') : '—';
}

function setLoadKey(setN: number) { return `set_${setN}_load`; }
function setRpeKey(setN: number)  { return `set_${setN}_rpe`; }
function setDoneKey(setN: number) { return `set_${setN}_completed`; }

function getSetLoad(ex: ExercisePlan, setN: number): string {
  const v = ex.values?.[setLoadKey(setN)];
  if (v != null && v !== '') return v;
  if (setN === 1 && ex.actualLoad) return ex.actualLoad;
  return '';
}
function getSetRpe(ex: ExercisePlan, setN: number): string {
  const v = ex.values?.[setRpeKey(setN)];
  if (v != null && v !== '') return v;
  if (setN === 1 && ex.actualRpe) return ex.actualRpe;
  return '';
}
function isSetDone(ex: ExercisePlan, setN: number): boolean {
  return ex.values?.[setDoneKey(setN)] === '1';
}
function setCount(ex: ExercisePlan): number {
  const n = ex.sets;
  if (typeof n === 'number' && n > 0) return Math.min(n, 20);
  return 1;
}
function countDoneSets(ex: ExercisePlan): number {
  let count = 0;
  const total = setCount(ex);
  for (let i = 1; i <= total; i += 1) {
    if (isSetDone(ex, i)) count += 1;
  }
  return count;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface WorkoutGridLoggerProps {
  client: Client;
  program: Program;
  week: WorkoutWeek;
  day: WorkoutDay;
  onBack: () => void;
  /** Silent autosave — persists actuals without marking the day complete
   *  and without exiting the workout view. Called on a debounced
   *  timer after every input change. */
  onAutoSave: (updatedDay: WorkoutDay) => Promise<void>;
  /** Explicit "Finish Workout" — marks the day complete and exits. The
   *  trainee triggers this only when they're done with the session. */
  onFinish: (updatedDay: WorkoutDay) => Promise<void> | void;
}

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DEBOUNCE_MS = 800;

// ─── Component ───────────────────────────────────────────────────────────────

export function WorkoutGridLogger({
  client,
  program,
  week,
  day,
  onBack,
  onAutoSave,
  onFinish,
}: WorkoutGridLoggerProps) {
  const [exercises, setExercises] = useState<ExercisePlan[]>(day.exercises);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  // Tracks every blob: URL created during this session so we can revoke them
  // all on unmount. URL.createObjectURL pins memory until revokeObjectURL is
  // called; without this, uploading multiple videos in one workout leaks.
  const blobUrlsRef = useRef<string[]>([]);
  const [plateCalcOpen, setPlateCalcOpen] = useState(false);
  const [plateCalcWeight, setPlateCalcWeight] = useState('');
  const [plateCalcExerciseId, setPlateCalcExerciseId] = useState<string | null>(null);
  const [plateCalcSetN, setPlateCalcSetN] = useState<number>(1);

  const columns = program.columns ?? DEFAULT_COLUMNS;
  const notesIsActual = columns.some((c) => c.id === 'notes' && c.type === 'actual');

  // ── Autosave plumbing ───────────────────────────────────────────────────
  // Every change to `exercises` schedules a save 800ms later. If the
  // trainee keeps typing, the timer resets — only the last value of a
  // typing burst hits the network. On unmount (back button, browser
  // close, parent route change) we flush any pending save synchronously
  // so no keystroke is lost.
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped every time `exercises` changes so the autosave callback can
  // verify it's saving the LATEST snapshot — drops stale saves on the floor.
  const editVersionRef = useRef(0);
  // Skip the autosave-on-mount: the initial useState already has the
  // server's data, no need to re-write it.
  const hasUserEditedRef = useRef(false);
  // Stable refs to props so the cleanup useEffect can flush without
  // re-binding every render.
  const exercisesRef = useRef(exercises);
  exercisesRef.current = exercises;
  const dayRef = useRef(day);
  dayRef.current = day;
  const onAutoSaveRef = useRef(onAutoSave);
  onAutoSaveRef.current = onAutoSave;

  const flushSaveNow = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const myVersion = editVersionRef.current;
    setSaveStatus('saving');
    try {
      await onAutoSaveRef.current({ ...dayRef.current, exercises: exercisesRef.current });
      // Only flip to "saved" if no newer edit landed mid-flight.
      if (myVersion === editVersionRef.current) {
        setSaveStatus('saved');
        setLastSavedAt(Date.now());
      }
    } catch (err) {
      console.error('[IronTrack] autosave failed', err);
      setSaveStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!hasUserEditedRef.current) return;
    setSaveStatus('dirty');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushSaveNow();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [exercises, flushSaveNow]);

  // Flush on unmount — covers the back-arrow exit, the parent route swap,
  // and tab-close (browser does best-effort beforeunload). Without this,
  // a keystroke made <800ms before exit would be lost.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        // Fire-and-forget — we're tearing down anyway. The mutation is
        // idempotent (UPDATE by id) so a duplicate is harmless if the
        // browser somehow flushes it after the new view fetches.
        void onAutoSaveRef.current({ ...dayRef.current, exercises: exercisesRef.current });
      }
    };
  }, []);

  // Derived workout-level progress for the gradient progress bar at the top.
  const totalSets = useMemo(
    () => exercises.reduce((acc, ex) => acc + setCount(ex), 0),
    [exercises],
  );
  const totalDone = useMemo(
    () => exercises.reduce((acc, ex) => acc + countDoneSets(ex), 0),
    [exercises],
  );
  const progressPct = totalSets === 0 ? 0 : Math.round((totalDone / totalSets) * 100);

  /** Generic update — same signature as before so existing tests/callers
   *  keep working. New per-set keys (`set_<n>_load`, `set_<n>_rpe`,
   *  `set_<n>_completed`) drop into ex.values automatically. Set-1 numeric
   *  writes also mirror to legacy ex.actualLoad / ex.actualRpe so analytics
   *  views stay coherent.
   *
   *  Numeric fields are sanitized through `sanitizeOnType` before they hit
   *  state — this is what stops a trainee from typing "9999999" into a kg
   *  field or "13" into RPE. The sanitizer enforces max + character class;
   *  the matching `clampOnCommit` runs on blur (via `commitField` below)
   *  so the final stored value also satisfies min. */
  const setMatchRegex = /^set_(\d+)_(load|rpe)$/;
  const updateExercise = (id: string, field: string, rawValue: string) => {
    const setMatch = field.match(setMatchRegex);
    let value = rawValue;
    if (setMatch?.[2] === 'load' || field === 'actualLoad') {
      value = sanitizeOnType(rawValue, 'load');
    } else if (setMatch?.[2] === 'rpe' || field === 'actualRpe') {
      value = sanitizeOnType(rawValue, 'rpe');
    }

    if (['actualLoad', 'actualRpe'].includes(field) && value.trim() !== '') {
      hapticTick();
    }
    hasUserEditedRef.current = true;
    editVersionRef.current += 1;
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex.id !== id) return ex;
        if (['actualLoad', 'actualRpe', 'notes', 'videoUrl'].includes(field)) {
          return { ...ex, [field]: value };
        }
        const next: ExercisePlan = {
          ...ex,
          values: { ...(ex.values ?? {}), [field]: value },
        };
        if (setMatch && setMatch[1] === '1') {
          if (setMatch[2] === 'load') next.actualLoad = value;
          else if (setMatch[2] === 'rpe') next.actualRpe = value;
        }
        return next;
      }),
    );
  };

  /** Final clamp on blur. Without this, a trainee who types "0.5" and tabs
   *  away would leave RPE at 0.5 (below the 1.0 floor). */
  const commitField = (id: string, field: string, raw: string) => {
    const setMatch = field.match(setMatchRegex);
    let cleaned = raw;
    if (setMatch?.[2] === 'load' || field === 'actualLoad') {
      cleaned = clampOnCommit(raw, 'load');
    } else if (setMatch?.[2] === 'rpe' || field === 'actualRpe') {
      cleaned = clampOnCommit(raw, 'rpe');
    } else {
      return;
    }
    if (cleaned !== raw) updateExercise(id, field, cleaned);
  };

  // Note: the per-exercise `__completed` flag is no longer toggled by a
  // UI button (the per-set Done toggles drive the visible completion
  // state). Persistence via the COMPLETED_KEY in ex.values is preserved —
  // any caller can still set it through the generic updateExercise(id,
  // '__completed', '1') path, which lands in ex.values via the catch-all.

  const toggleSetDone = (id: string, setN: number) => {
    hapticTick();
    hasUserEditedRef.current = true;
    editVersionRef.current += 1;
    const key = setDoneKey(setN);
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex.id !== id) return ex;
        const flipped = ex.values?.[key] === '1' ? '0' : '1';
        return { ...ex, values: { ...(ex.values ?? {}), [key]: flipped } };
      }),
    );
  };

  const handleFinish = useCallback(async () => {
    // Cancel the pending autosave — onFinish persists everything AND marks
    // the day complete, so the autosave would just be redundant.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    hapticHeavy();
    setSaveStatus('saving');
    try {
      await onFinish({ ...dayRef.current, exercises: exercisesRef.current });
      // After a successful finish the parent unmounts this component, so
      // setSaveStatus('saved') would be a no-op. Leave it.
    } catch (err) {
      console.error('[IronTrack] finish failed', err);
      setSaveStatus('error');
    }
  }, [onFinish]);

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingFor) return;

    // 100 MB ceiling — large enough for a short coaching clip, small enough
    // to avoid pinning dozens of MB of object URLs in the browser heap.
    const MAX_BYTES = 100 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      alert(`Video too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximum is 100 MB.`);
      setUploadingFor(null);
      return;
    }

    // Revoke any existing blob URL on the exercise being overwritten so the
    // browser can release the memory from the previous upload immediately.
    const prevUrl = exercisesRef.current.find((ex) => ex.id === uploadingFor)?.videoUrl;
    if (prevUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(prevUrl);
      blobUrlsRef.current = blobUrlsRef.current.filter((u) => u !== prevUrl);
    }

    const url = URL.createObjectURL(file);
    blobUrlsRef.current.push(url);
    updateExercise(uploadingFor, 'videoUrl', url);
    setUploadingFor(null);
  };

  // Release any remaining blob URLs when the workout logger unmounts.
  // Covers the case where the coach uploads a video and then hits "Finish"
  // or "Back" before the URL would otherwise be revoked.
  // blobUrlsRef is listed as a dep so noUnusedLocals can trace the read;
  // the ref is stable so the effect still runs exactly once on mount/unmount.
  useEffect(() => {
    return () => {
      for (const url of blobUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      blobUrlsRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blobUrlsRef]);

  // Confirmation handler — wraps handleFinish with a check for partially-
  // logged sessions. We use window.confirm because it's the simplest
  // dependable cross-platform dialog and matches the pattern already used
  // by archive/delete elsewhere in the app.
  const handleFinishWithConfirm = useCallback(async () => {
    const total = exercises.reduce((s, ex) => s + setCount(ex), 0);
    const done = exercises.reduce((s, ex) => s + countDoneSets(ex), 0);
    if (total > 0 && done < total) {
      const ok = window.confirm(
        `${done} of ${total} sets logged. Finish workout anyway?`,
      );
      if (!ok) return;
    }
    await handleFinish();
  }, [exercises, handleFinish]);

  return (
    <div className="space-y-4 md:space-y-6 h-full flex flex-col">
      {/* ── Top header ─────────────────────────────────────────────────────
           Premium feel: client/day metadata on the left, save-status
           indicator + Finish CTA on the right. */}
      <header className="flex justify-between items-end gap-3">
        <div className="flex items-center gap-3 md:gap-5 min-w-0">
          <button
            onClick={onBack}
            aria-label="Back"
            className="shrink-0 w-11 h-11 border border-border/60 bg-card/60 backdrop-blur-md hover:bg-muted/40 hover:border-foreground/30 transition-all flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Flame className="w-3.5 h-3.5 text-orange-400/80" />
              <span className="text-[9px] md:text-[10px] font-mono text-muted-foreground uppercase tracking-[0.18em]">
                {client.name} · Week {week.weekNumber}
              </span>
            </div>
            <h1 className="text-2xl md:text-4xl font-bold tracking-tighter italic font-serif text-foreground truncate leading-none">
              {day.name}
            </h1>
            <SaveStatusBadge status={saveStatus} lastSavedAt={lastSavedAt} />
          </div>
        </div>
        <button
          onClick={() => void handleFinishWithConfirm()}
          data-testid="finish-session-btn"
          aria-label="Finish workout"
          className="
            btn-press shrink-0 group relative overflow-hidden
            bg-accent text-background px-4 md:px-6 py-3 md:py-3.5
            text-[10px] md:text-xs font-bold uppercase tracking-[0.14em]
            shadow-[0_0_12px_rgba(0,255,136,0.3)]
            hover:shadow-[0_0_20px_rgba(0,255,136,0.45)] hover:-translate-y-0.5
            transition-all duration-200
            flex items-center gap-2 min-h-[44px]
          "
        >
          <Trophy className="w-4 h-4" />
          <span className="hidden md:inline">Finish Workout</span>
        </button>
      </header>

      {/* ── Workout-level progress ─────────────────────────────────────
           A real bar + a separate count chip on the right so the numbers
           read cleanly regardless of which color the bar is currently
           painted in. */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
          <motion.div
            className="absolute inset-y-0 left-0 right-0 bg-gradient-to-r from-primary via-primary/80 to-primary shadow-[0_0_12px_rgba(0,212,255,0.4)]"
            style={{ transformOrigin: 'left' }}
            animate={{ scaleX: progressPct / 100 }}
            transition={{ type: 'spring', stiffness: 180, damping: 24 }}
          />
        </div>
        <div className="shrink-0 flex items-baseline gap-1 text-[10px] font-mono tabular-nums text-foreground/90">
          <span className="font-bold">{totalDone}</span>
          <span className="text-muted-foreground/70">/ {totalSets}</span>
          <span className="text-muted-foreground/60 uppercase tracking-widest text-[9px] ml-1">sets</span>
        </div>
      </div>

      {/* ── Exercise stack ─────────────────────────────────────────────── */}
      <div className="flex-grow overflow-auto -mx-2 md:mx-0 px-2 md:px-0 space-y-3 md:space-y-4 pb-4">
        {exercises.map((ex, idx) => {
          const completed = isCompleted(ex);
          const planSummary = buildPlanSummary(ex, columns);
          const sets = setCount(ex);
          const setsDone = countDoneSets(ex);
          const allSetsDone = sets > 0 && setsDone === sets;
          const notesValue = ex.notes ?? '';
          // Progressive-overload reference: walks back to the most recent
          // prior week with logged data for this `(dayNumber, exerciseName)`.
          // Returns `{ exercise, fromWeekNumber }` so the chip can label
          // "Last week" vs an honest "Week 1" when the trainee skipped a week.
          const prevSession = findPreviousWeekExercise(
            program,
            week.weekNumber,
            day.dayNumber,
            ex.exerciseName,
          );
          const isLiteralLastWeek =
            prevSession !== null && prevSession.fromWeekNumber === week.weekNumber - 1;
          // RPE autoregulation: scan the trainee's last 3 logged sessions on
          // this exercise and suggest a load nudge when actual RPE has been
          // drifting from prescribed.
          const autoreg = rpeAutoregulationSuggestion(client, ex.exerciseId);

          return (
            <motion.section
              key={ex.id}
              data-testid={`exercise-row-${idx}`}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: idx * 0.02 }}
              className={cn(
                'relative group overflow-hidden',
                'border transition-all duration-300',
                completed
                  ? 'border-accent/30 bg-gradient-to-b from-accent/5 via-card to-card opacity-80'
                  : allSetsDone
                    ? 'border-accent/40 bg-gradient-to-b from-accent/[0.06] via-card to-card shadow-[0_0_0_1px_rgba(0,255,136,0.08),0_8px_32px_-12px_rgba(0,255,136,0.2)]'
                    : 'border-border/60 bg-gradient-to-b from-card via-card to-card/80 shadow-[0_8px_28px_-12px_rgba(0,0,0,0.45)] hover:border-primary/30',
              )}
            >
              {/* Sticky exercise header — pinned at the top of the scroll
                  area so the current exercise's name + plan stay visible
                  while the trainee works through its sets. */}
              <header
                className={cn(
                  'sticky top-0 z-10 backdrop-blur-md',
                  'flex items-center gap-3 px-3 md:px-4 py-3',
                  'border-b border-border/40',
                  completed ? 'bg-card/80' : 'bg-card/95',
                )}
                data-testid={`exercise-header-${idx}`}
              >
                {/* Number badge with subtle gradient. Turns emerald when
                    every set is done. */}
                <div
                  className={cn(
                    'shrink-0 w-11 h-11 md:w-12 md:h-12',
                    'flex items-center justify-center',
                    'text-sm md:text-base font-bold font-mono tabular-nums',
                    'border transition-all duration-300',
                    allSetsDone
                      ? 'bg-gradient-to-br from-accent to-accent/80 text-background border-accent/40 shadow-[0_0_12px_rgba(0,255,136,0.3)]'
                      : 'bg-surface text-foreground border-border/60',
                  )}
                >
                  {String(idx + 1).padStart(2, '0')}
                </div>

                <div className="min-w-0 flex-1">
                  <h3
                    className="text-base md:text-lg font-display font-bold uppercase tracking-wide text-foreground truncate leading-tight"
                    title={ex.exerciseName}
                  >
                    {ex.exerciseName}
                  </h3>
                  <div
                    className="mt-1 text-[10px] md:text-[11px] font-mono text-muted-foreground truncate flex items-center gap-1.5"
                    data-testid={`plan-summary-${idx}`}
                  >
                    <span className="opacity-60">Plan:</span>
                    <span className="text-foreground/80">{planSummary}</span>
                  </div>
                </div>

                {/* Right-side actions: progress chip + video + done */}
                <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
                  {/* Progress chip — instant readout of "where am I". */}
                  <div
                    className={cn(
                      'hidden sm:flex items-center gap-1 px-2.5 py-1 text-[10px] font-mono tabular-nums border transition-colors',
                      allSetsDone
                        ? 'bg-accent/15 border-accent/30 text-accent'
                        : 'bg-muted/40 border-border/40 text-muted-foreground',
                    )}
                  >
                    <span className="font-bold">{setsDone}</span>
                    <span className="opacity-60">/</span>
                    <span>{sets}</span>
                  </div>

                  {ex.videoUrl ? (
                    <a
                      href={ex.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Play video"
                      className="w-10 h-10 flex items-center justify-center bg-primary/10 text-primary border border-primary/20 hover:bg-primary/10 hover:text-white hover:border-primary transition-all"
                    >
                      <Play className="w-4 h-4" />
                    </a>
                  ) : (
                    <button
                      onClick={() => { setUploadingFor(ex.id); fileInputRef.current?.click(); }}
                      aria-label="Upload video"
                      className="w-10 h-10 flex items-center justify-center bg-muted/40 text-muted-foreground border border-border/40 hover:bg-muted hover:text-foreground hover:border-foreground/30 transition-all"
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </header>

              {/* RPE autoregulation suggestion — only surfaces when there's
                  enough data and the trend is meaningfully off-target. */}
              {autoreg.suggestion !== null && autoreg.suggestion !== 'maintain' && (
                <div
                  data-testid={`autoreg-banner-${idx}`}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 border-b text-[10px] font-mono uppercase tracking-widest',
                    autoreg.suggestion === 'increase'
                      ? 'bg-accent/5 border-accent/20 text-accent'
                      : 'bg-warning/5 border-warning/20 text-warning',
                  )}
                >
                  {autoreg.suggestion === 'increase'
                    ? <TrendingUp className="w-3 h-3 shrink-0" />
                    : <TrendingDown className="w-3 h-3 shrink-0" />
                  }
                  <span>
                    {autoreg.suggestion === 'increase'
                      ? `Avg RPE ${autoreg.avgDelta !== null ? Math.abs(autoreg.avgDelta) : ''}pts below target — consider adding load`
                      : `Avg RPE ${autoreg.avgDelta !== null ? autoreg.avgDelta : ''}pts above target — consider reducing load`
                    }
                  </span>
                  <span className="ml-auto opacity-50">({autoreg.sessionCount} sessions)</span>
                </div>
              )}

              {/* Set rows */}
              <div className="divide-y divide-border/30">
                {Array.from({ length: sets }, (_, i) => {
                  const setN = i + 1;
                  const loadValue = getSetLoad(ex, setN);
                  const rpeValue = getSetRpe(ex, setN);
                  const setDone = isSetDone(ex, setN);
                  const loadFilled = loadValue.trim() !== '';
                  const rpeFilled = rpeValue.trim() !== '';
                  // Per-set values from the matched prior session. Show
                  // them only when at least one of (load, rpe) was logged
                  // — empty sets from prior weeks aren't a useful reference.
                  const prevLoad = getPreviousSetLoad(prevSession, setN);
                  const prevRpe = getPreviousSetRpe(prevSession, setN);
                  const hasPrev = prevLoad !== null || prevRpe !== null;
                  // Delta vs current load: enables the ↑/=/↓ trend arrow.
                  // Only meaningful once the trainee has typed today's load.
                  const currentLoadNum = parseNumeric(loadValue, 'load');
                  const prevLoadNum = prevLoad !== null ? parseNumeric(prevLoad, 'load') : null;
                  const loadDelta =
                    currentLoadNum !== null && prevLoadNum !== null && prevLoadNum > 0
                      ? Math.round((currentLoadNum - prevLoadNum) * 10) / 10
                      : null;

                  return (
                    <div
                      key={setN}
                      data-testid={`set-row-${ex.id}-${setN}`}
                      className={cn(
                        'flex flex-col gap-1 px-3 md:px-4 py-2.5 md:py-3 transition-colors',
                        setDone
                          ? 'bg-accent/[0.07]'
                          : 'hover:bg-white/[0.02]',
                      )}
                    >
                      <div className="flex items-center gap-2">
                      {/* Set badge */}
                      <div
                        className={cn(
                          'shrink-0 w-9 h-9 md:w-10 md:h-10 flex items-center justify-center',
                          'text-xs md:text-sm font-bold font-mono tabular-nums border transition-all',
                          setDone
                            ? 'bg-accent/15 text-accent border-accent/30'
                            : 'bg-muted/30 text-muted-foreground border-border/40',
                        )}
                      >
                        {setN}
                      </div>

                      {/* Weight cell — gets the most space, large readable
                          text when filled, soft placeholder when empty.
                          The plate-calc icon lives inside the cell. */}
                      <div
                        className={cn(
                          'flex-1 flex items-baseline gap-1 px-2.5 md:px-3 py-1 border transition-all',
                          'focus-within:border-primary/60 focus-within:bg-primary/5',
                          loadFilled
                            ? 'bg-muted/30 border-border/60'
                            : 'bg-muted/15 border-border/30',
                        )}
                      >
                        <input
                          type="text"
                          value={loadValue}
                          onChange={(e) => updateExercise(ex.id, setLoadKey(setN), e.target.value)}
                          onBlur={(e) => commitField(ex.id, setLoadKey(setN), e.target.value)}
                          placeholder="0"
                          maxLength={6}
                          inputMode="decimal"
                          pattern="[0-9.]*"
                          autoComplete="off"
                          data-testid={`input-${ex.id}-set-${setN}-load`}
                          aria-label={`Set ${setN} weight`}
                          aria-valuemin={0}
                          aria-valuemax={1000}
                          className={cn(
                            'bg-transparent w-full outline-none border-none focus:ring-0',
                            'text-base md:text-lg font-bold tabular-nums tracking-tight',
                            'placeholder:text-muted-foreground/30 placeholder:font-light',
                            'min-h-[44px]',
                            loadFilled ? 'text-foreground' : 'text-muted-foreground',
                          )}
                        />
                        <span className="text-[9px] md:text-[10px] font-mono text-muted-foreground uppercase tracking-widest shrink-0">
                          kg
                        </span>
                        <button
                          onClick={() => {
                            setPlateCalcWeight(loadValue);
                            setPlateCalcExerciseId(ex.id);
                            setPlateCalcSetN(setN);
                            setPlateCalcOpen(true);
                          }}
                          aria-label="Plate calculator"
                          data-testid={`plate-calc-btn-${ex.id}-set-${setN}`}
                          className="shrink-0 p-1 text-muted-foreground/60 hover:text-primary hover:bg-primary/10 transition-colors"
                        >
                          <Calculator className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* RPE cell — narrower, paired unit label "rpe" */}
                      <div
                        className={cn(
                          'shrink-0 w-[88px] md:w-[100px] flex items-baseline gap-1 px-2.5 md:px-3 py-1 border transition-all',
                          'focus-within:border-primary/60 focus-within:bg-primary/5',
                          rpeFilled
                            ? 'bg-muted/30 border-border/60'
                            : 'bg-muted/15 border-border/30',
                        )}
                      >
                        <input
                          type="text"
                          value={rpeValue}
                          onChange={(e) => updateExercise(ex.id, setRpeKey(setN), e.target.value)}
                          onBlur={(e) => commitField(ex.id, setRpeKey(setN), e.target.value)}
                          placeholder="—"
                          maxLength={4}
                          inputMode="decimal"
                          pattern="[0-9.]*"
                          autoComplete="off"
                          data-testid={`input-${ex.id}-set-${setN}-rpe`}
                          aria-label={`Set ${setN} RPE`}
                          aria-valuemin={1}
                          aria-valuemax={10}
                          className={cn(
                            'bg-transparent w-full outline-none border-none focus:ring-0',
                            'text-base md:text-lg font-bold tabular-nums tracking-tight',
                            'placeholder:text-muted-foreground/30 placeholder:font-light',
                            'min-h-[44px]',
                            rpeFilled ? 'text-foreground' : 'text-muted-foreground',
                          )}
                        />
                        <span className="text-[9px] md:text-[10px] font-mono text-muted-foreground uppercase tracking-widest shrink-0">
                          rpe
                        </span>
                      </div>

                      {/* Per-set Done */}
                      <button
                        onClick={() => toggleSetDone(ex.id, setN)}
                        aria-label={setDone ? `Set ${setN} not done` : `Mark set ${setN} done`}
                        aria-pressed={setDone}
                        data-testid={`set-done-toggle-${ex.id}-${setN}`}
                        className={cn(
                          'shrink-0 w-10 h-10 flex items-center justify-center border transition-all',
                          setDone
                            ? 'bg-accent border-accent/40 text-background shadow-[0_0_12px_rgba(0,255,136,0.35)]'
                            : 'bg-muted/30 border-border/40 text-muted-foreground hover:border-accent/40 hover:text-accent',
                        )}
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span
                            key={setDone ? 'done' : 'pending'}
                            initial={{ scale: 0.6, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.6, opacity: 0 }}
                            transition={{ duration: 0.12 }}
                          >
                            <Check className={cn('w-4 h-4', setDone ? 'opacity-100' : 'opacity-30')} />
                          </motion.span>
                        </AnimatePresence>
                      </button>
                      </div>

                      {/* Progressive-overload reference: most recent prior
                          session's same-set numbers, plus a ↑/=/↓ delta
                          once the trainee has entered today's load. Hidden
                          when there's no prior data so fresh week-1
                          sessions stay clean. */}
                      {hasPrev && prevSession && (
                        <div
                          data-testid={`prev-week-${ex.id}-${setN}`}
                          data-prev-week-number={prevSession.fromWeekNumber}
                          className="
                            ml-11 md:ml-12 mr-1 -mt-0.5
                            flex items-center gap-1.5 flex-wrap
                            text-[10px] md:text-[11px] font-mono tabular-nums
                            text-muted-foreground/70
                          "
                        >
                          <History className="w-3 h-3 opacity-60 shrink-0" />
                          <span className="opacity-70 uppercase tracking-[0.14em]">
                            {isLiteralLastWeek
                              ? 'Last week'
                              : `Week ${prevSession.fromWeekNumber}`}
                          </span>
                          {prevLoad !== null && (
                            <span className="text-foreground/70">
                              {prevLoad}<span className="opacity-60"> kg</span>
                            </span>
                          )}
                          {prevLoad !== null && prevRpe !== null && (
                            <span className="opacity-40">·</span>
                          )}
                          {prevRpe !== null && (
                            <span className="text-foreground/70">
                              <span className="opacity-60">RPE </span>{prevRpe}
                            </span>
                          )}
                          {loadDelta !== null && (
                            <DeltaBadge delta={loadDelta} testId={`prev-week-delta-${ex.id}-${setN}`} />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Notes */}
              {notesIsActual && (
                <div className="border-t border-border/30 px-3 md:px-4 py-2.5 flex items-center gap-2 bg-card/40">
                  <StickyNote className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                  <input
                    type="text"
                    value={notesValue}
                    onChange={(e) => updateExercise(ex.id, 'notes', e.target.value)}
                    placeholder="Notes for this exercise…"
                    maxLength={150}
                    autoComplete="off"
                    data-testid={`input-${ex.id}-notes`}
                    aria-label="Notes"
                    className="
                      bg-transparent w-full outline-none border-none focus:ring-0
                      text-[12px] md:text-xs italic text-foreground
                      placeholder:text-muted-foreground/40 placeholder:not-italic
                      min-h-[28px]
                    "
                  />
                </div>
              )}
            </motion.section>
          );
        })}

        {/* ── Bottom Finish CTA ─────────────────────────────────────────
             Lives inside the scroll area so the trainee naturally hits it
             after the last exercise. The big green hero is the obvious
             "I'm done" target — pairs with the smaller header CTA for
             when the user wants to bail out earlier. */}
        <button
          onClick={() => void handleFinishWithConfirm()}
          data-testid="finish-session-btn-bottom"
          className="
            mt-2 group relative overflow-hidden w-full
            border border-accent/40
            bg-gradient-to-br from-accent/15 via-accent/8 to-card
            shadow-[0_8px_32px_-12px_rgba(0,255,136,0.45)]
            hover:border-accent/60 hover:shadow-[0_8px_40px_-10px_rgba(0,255,136,0.55)]
            transition-all duration-300 px-5 md:px-7 py-5 md:py-6
            flex items-center gap-4 md:gap-5
          "
        >
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-accent/15 rounded-full blur-3xl pointer-events-none" />
          <div className="
            shrink-0 w-12 h-12 md:w-14 md:h-14
            bg-accent text-background
            flex items-center justify-center
            shadow-[0_0_16px_rgba(0,255,136,0.4)]
            group-hover:scale-105 transition-transform duration-200
          ">
            <Trophy className="w-5 h-5 md:w-6 md:h-6" />
          </div>
          <div className="relative min-w-0 flex-1 text-left">
            <div className="text-[10px] md:text-[11px] font-mono uppercase tracking-[0.18em] text-accent/90">
              {totalDone === totalSets ? 'All Sets Logged' : `${totalDone} / ${totalSets} Sets Logged`}
            </div>
            <div className="text-lg md:text-xl font-display font-bold tracking-tight text-foreground mt-0.5">
              Finish Workout
            </div>
            <div className="text-[10px] md:text-[11px] font-mono text-muted-foreground mt-0.5">
              Marks today complete and returns to your dashboard
            </div>
          </div>
        </button>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="video/*"
        onChange={handleVideoUpload}
      />

      <PlateCalculator
        isOpen={plateCalcOpen}
        onClose={() => {
          setPlateCalcOpen(false);
          setPlateCalcExerciseId(null);
        }}
        initialWeight={plateCalcWeight}
        onApply={(weight) => {
          if (plateCalcExerciseId) {
            updateExercise(plateCalcExerciseId, setLoadKey(plateCalcSetN), weight);
          }
          setPlateCalcOpen(false);
          setPlateCalcExerciseId(null);
        }}
      />
    </div>
  );
}

/**
 * Subtle save indicator under the day-name title. Renders nothing when
 * idle to keep the header clean for fresh sessions; once the trainee
 * starts editing, switches to "Saving…" / "Saved" / "Unsaved changes" /
 * "Save failed" with appropriate iconography.
 */
function SaveStatusBadge({
  status,
  lastSavedAt,
}: {
  status: SaveStatus;
  lastSavedAt: number | null;
}) {
  if (status === 'idle') return null;
  const ago = lastSavedAt ? Math.max(0, Math.round((Date.now() - lastSavedAt) / 1000)) : null;
  const cfg =
    status === 'saving'
      ? {
          icon: <Loader2 className="w-3 h-3 animate-spin" />,
          text: 'Saving…',
          tone: 'text-muted-foreground',
        }
      : status === 'saved'
        ? {
            icon: <Cloud className="w-3 h-3" />,
            text: ago != null && ago < 60 ? 'Saved' : `Saved · ${ago}s ago`,
            tone: 'text-emerald-400/80',
          }
        : status === 'error'
          ? {
              icon: <CloudOff className="w-3 h-3" />,
              text: 'Save failed — keep typing to retry',
              tone: 'text-red-400',
            }
          : {
              // status === 'dirty' — edit just landed, autosave timer ticking
              icon: <Cloud className="w-3 h-3 opacity-50" />,
              text: 'Unsaved changes',
              tone: 'text-amber-400/80',
            };
  return (
    <div
      className={cn(
        'mt-1 flex items-center gap-1 text-[9px] md:text-[10px] font-mono uppercase tracking-[0.18em]',
        cfg.tone,
      )}
      data-testid="save-status"
      aria-live="polite"
    >
      {cfg.icon}
      <span>{cfg.text}</span>
    </div>
  );
}

/**
 * Inline trend badge for the per-set "last week" chip. Reads the *load*
 * delta vs the prior session and renders one of:
 *   ↑ +5 kg   (gain — emerald)
 *   = same    (matched — muted)
 *   ↓ -2.5 kg (drop — amber)
 *
 * Surfaced only once the trainee has typed today's load — until then there's
 * nothing to compare to. RPE deltas are intentionally NOT plotted here:
 * "lower RPE at the same weight = improvement" is the right signal for RPE,
 * but it requires the load to be *equal*, which adds branching that hurts
 * gym-floor readability. Load alone is the dominant progressive-overload cue.
 */
function DeltaBadge({ delta, testId }: { delta: number; testId: string }) {
  if (delta > 0) {
    return (
      <span
        data-testid={testId}
        data-delta-direction="up"
        className="inline-flex items-center gap-0.5 px-1.5 py-px border border-accent/30 bg-accent/10 text-accent"
      >
        <TrendingUp className="w-2.5 h-2.5" />
        <span>+{delta}</span>
        <span className="opacity-60"> kg</span>
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span
        data-testid={testId}
        data-delta-direction="down"
        className="inline-flex items-center gap-0.5 px-1.5 py-px border border-danger/30 bg-danger/10 text-danger"
      >
        <TrendingDown className="w-2.5 h-2.5" />
        <span>{delta}</span>
        <span className="opacity-60"> kg</span>
      </span>
    );
  }
  return (
    <span
      data-testid={testId}
      data-delta-direction="same"
      className="inline-flex items-center gap-0.5 px-1.5 py-px border border-border/50 bg-muted/30 text-muted-foreground"
    >
      <Minus className="w-2.5 h-2.5" />
      <span>same</span>
    </span>
  );
}

// Re-export TechnicalCard to keep tree-shake hints stable for any callsite
// that previously imported via this file.
export { TechnicalCard };
