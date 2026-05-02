import React, { useState, useRef, useMemo } from 'react';
import {
  ArrowLeft,
  Save,
  Upload,
  Play,
  Calculator,
  Check,
  Flame,
  StickyNote,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TechnicalCard } from '../ui';
import { cn } from '../../lib/utils';
import { DEFAULT_COLUMNS } from '../../constants/mockData';
import { PlateCalculator } from './PlateCalculator';
import { hapticTick, hapticSuccess } from '../../lib/haptics';
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
  onSave: (updatedDay: WorkoutDay) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function WorkoutGridLogger({
  client,
  program,
  week,
  day,
  onBack,
  onSave,
}: WorkoutGridLoggerProps) {
  const [exercises, setExercises] = useState<ExercisePlan[]>(day.exercises);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [plateCalcOpen, setPlateCalcOpen] = useState(false);
  const [plateCalcWeight, setPlateCalcWeight] = useState('');
  const [plateCalcExerciseId, setPlateCalcExerciseId] = useState<string | null>(null);
  const [plateCalcSetN, setPlateCalcSetN] = useState<number>(1);

  const columns = program.columns ?? DEFAULT_COLUMNS;
  const notesIsActual = columns.some((c) => c.id === 'notes' && c.type === 'actual');

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
   *  views stay coherent. */
  const updateExercise = (id: string, field: string, value: string) => {
    if (['actualLoad', 'actualRpe'].includes(field) && value.trim() !== '') {
      hapticTick();
    }
    const setMatch = field.match(/^set_(\d+)_(load|rpe)$/);
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

  // Note: the per-exercise `__completed` flag is no longer toggled by a
  // UI button (the per-set Done toggles drive the visible completion
  // state). Persistence via the COMPLETED_KEY in ex.values is preserved —
  // any caller can still set it through the generic updateExercise(id,
  // '__completed', '1') path, which lands in ex.values via the catch-all.

  const toggleSetDone = (id: string, setN: number) => {
    hapticTick();
    const key = setDoneKey(setN);
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex.id !== id) return ex;
        const flipped = ex.values?.[key] === '1' ? '0' : '1';
        return { ...ex, values: { ...(ex.values ?? {}), [key]: flipped } };
      }),
    );
  };

  const handleSave = () => {
    hapticSuccess();
    onSave({ ...day, exercises });
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0] && uploadingFor) {
      const url = URL.createObjectURL(e.target.files[0]);
      updateExercise(uploadingFor, 'videoUrl', url);
      setUploadingFor(null);
    }
  };

  return (
    <div className="space-y-4 md:space-y-6 h-full flex flex-col">
      {/* ── Top header ─────────────────────────────────────────────────────
           Premium feel: client/day metadata on the left, prominent save
           button on the right. Day name italicised in the serif display
           face for hierarchy. */}
      <header className="flex justify-between items-end gap-3">
        <div className="flex items-center gap-3 md:gap-5 min-w-0">
          <button
            onClick={onBack}
            aria-label="Back"
            className="shrink-0 w-11 h-11 rounded-xl border border-border/60 bg-card/60 backdrop-blur-md hover:bg-muted/40 hover:border-foreground/30 transition-all flex items-center justify-center"
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
          </div>
        </div>
        <button
          onClick={handleSave}
          data-testid="save-session-btn"
          className="
            btn-press shrink-0 group relative overflow-hidden
            bg-gradient-to-br from-emerald-500 to-emerald-600
            text-white px-4 md:px-6 py-3 md:py-3.5
            text-[10px] md:text-xs font-bold uppercase tracking-[0.14em]
            rounded-xl shadow-lg shadow-emerald-500/20
            hover:shadow-xl hover:shadow-emerald-500/30 hover:-translate-y-0.5
            transition-all duration-200
            flex items-center gap-2 min-h-[44px]
          "
        >
          <Save className="w-4 h-4" />
          <span className="hidden md:inline">Save Session</span>
        </button>
      </header>

      {/* ── Workout-level progress ─────────────────────────────────────
           A real bar + a separate count chip on the right so the numbers
           read cleanly regardless of which color the bar is currently
           painted in. */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
          <motion.div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]"
            animate={{ width: `${progressPct}%` }}
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

          return (
            <motion.section
              key={ex.id}
              data-testid={`exercise-row-${idx}`}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: idx * 0.02 }}
              className={cn(
                'relative group rounded-2xl overflow-hidden',
                'border transition-all duration-300',
                completed
                  ? 'border-emerald-500/30 bg-gradient-to-b from-emerald-500/5 via-card to-card opacity-80'
                  : allSetsDone
                    ? 'border-emerald-500/40 bg-gradient-to-b from-emerald-500/[0.06] via-card to-card shadow-[0_0_0_1px_rgba(16,185,129,0.08),0_8px_32px_-12px_rgba(16,185,129,0.25)]'
                    : 'border-border/60 bg-gradient-to-b from-card via-card to-card/80 shadow-[0_8px_28px_-12px_rgba(0,0,0,0.45)] hover:border-foreground/20',
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
                    'shrink-0 w-11 h-11 md:w-12 md:h-12 rounded-xl',
                    'flex items-center justify-center',
                    'text-sm md:text-base font-bold font-mono tabular-nums',
                    'border transition-all duration-300',
                    allSetsDone
                      ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white border-emerald-400/40 shadow-md shadow-emerald-500/20'
                      : 'bg-gradient-to-br from-muted/60 to-muted/30 text-foreground border-border/60',
                  )}
                >
                  {String(idx + 1).padStart(2, '0')}
                </div>

                <div className="min-w-0 flex-1">
                  <h3
                    className="text-base md:text-lg font-bold uppercase tracking-tight italic font-serif text-foreground truncate leading-tight"
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
                      'hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-mono tabular-nums border transition-colors',
                      allSetsDone
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
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
                      className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500 hover:text-white hover:border-blue-500 transition-all"
                    >
                      <Play className="w-4 h-4" />
                    </a>
                  ) : (
                    <button
                      onClick={() => { setUploadingFor(ex.id); fileInputRef.current?.click(); }}
                      aria-label="Upload video"
                      className="w-10 h-10 rounded-xl flex items-center justify-center bg-muted/40 text-muted-foreground border border-border/40 hover:bg-muted hover:text-foreground hover:border-foreground/30 transition-all"
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </header>

              {/* Set rows */}
              <div className="divide-y divide-border/30">
                {Array.from({ length: sets }, (_, i) => {
                  const setN = i + 1;
                  const loadValue = getSetLoad(ex, setN);
                  const rpeValue = getSetRpe(ex, setN);
                  const setDone = isSetDone(ex, setN);
                  const loadFilled = loadValue.trim() !== '';
                  const rpeFilled = rpeValue.trim() !== '';

                  return (
                    <div
                      key={setN}
                      data-testid={`set-row-${ex.id}-${setN}`}
                      className={cn(
                        'flex items-center gap-2 px-3 md:px-4 py-2.5 md:py-3 transition-colors',
                        setDone
                          ? 'bg-emerald-500/[0.07]'
                          : 'hover:bg-white/[0.02]',
                      )}
                    >
                      {/* Set badge */}
                      <div
                        className={cn(
                          'shrink-0 w-9 h-9 md:w-10 md:h-10 rounded-lg flex items-center justify-center',
                          'text-xs md:text-sm font-bold font-mono tabular-nums border transition-all',
                          setDone
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
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
                          'flex-1 flex items-baseline gap-1 px-2.5 md:px-3 py-1 rounded-lg border transition-all',
                          'focus-within:border-foreground/40 focus-within:bg-muted/30',
                          loadFilled
                            ? 'bg-muted/30 border-border/60'
                            : 'bg-muted/15 border-border/30',
                        )}
                      >
                        <input
                          type="text"
                          value={loadValue}
                          onChange={(e) => updateExercise(ex.id, setLoadKey(setN), e.target.value)}
                          placeholder="0"
                          maxLength={10}
                          inputMode="decimal"
                          pattern="[0-9]*"
                          autoComplete="off"
                          data-testid={`input-${ex.id}-set-${setN}-load`}
                          aria-label={`Set ${setN} weight`}
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
                          className="shrink-0 p-1 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 transition-colors"
                        >
                          <Calculator className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* RPE cell — narrower, paired unit label "rpe" */}
                      <div
                        className={cn(
                          'shrink-0 w-[88px] md:w-[100px] flex items-baseline gap-1 px-2.5 md:px-3 py-1 rounded-lg border transition-all',
                          'focus-within:border-foreground/40 focus-within:bg-muted/30',
                          rpeFilled
                            ? 'bg-muted/30 border-border/60'
                            : 'bg-muted/15 border-border/30',
                        )}
                      >
                        <input
                          type="text"
                          value={rpeValue}
                          onChange={(e) => updateExercise(ex.id, setRpeKey(setN), e.target.value)}
                          placeholder="—"
                          maxLength={5}
                          inputMode="decimal"
                          pattern="[0-9]*"
                          autoComplete="off"
                          data-testid={`input-${ex.id}-set-${setN}-rpe`}
                          aria-label={`Set ${setN} RPE`}
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
                          'shrink-0 w-10 h-10 rounded-lg flex items-center justify-center border transition-all',
                          setDone
                            ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 border-emerald-400/40 text-white shadow-md shadow-emerald-500/20'
                            : 'bg-muted/30 border-border/40 text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-400',
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

// Re-export TechnicalCard to keep tree-shake hints stable for any callsite
// that previously imported via this file.
export { TechnicalCard };
