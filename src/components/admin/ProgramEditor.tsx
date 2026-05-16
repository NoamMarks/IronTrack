import { useState, useRef } from 'react';
import {
  Edit3,
  Trash2,
  X,
  BookmarkPlus,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  GripVertical,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TechnicalCard, TechnicalInput, Button } from '../ui';
import { ColumnModal } from './ColumnModal';
import { SaveTemplateModal } from './SaveTemplateModal';
import { ExerciseCombobox } from './ExerciseCombobox';
import { cn } from '../../lib/utils';
import { DEFAULT_COLUMNS } from '../../constants/mockData';
import { sanitizeOnType, clampOnCommit, kindForColumnId, RANGES } from '../../lib/numericInput';
import { useExerciseLibrary } from '../../hooks/useExerciseLibrary';
import type { Program, ProgramColumn, ExercisePlan, WorkoutWeek, WorkoutDay } from '../../types';

// ─── Helper ─────────────────────────────────────────────────────────────────

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

// ─── Props ───────────────────────────────────────────────────────────────────

interface ProgramEditorProps {
  program: Program;
  onChange: (updated: Program) => void;
  /** Optional handler — when provided, a "Save as Template" button is
   *  rendered next to the program name. The parent owns the templates
   *  hook so this component stays presentational. */
  onSaveAsTemplate?: (name: string, description: string) => Promise<void>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ProgramEditor({ program, onChange, onSaveAsTemplate }: ProgramEditorProps) {
  const [columnModalOpen, setColumnModalOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<ProgramColumn | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  // Batch-import panel state — at most one day can show the textarea at a
  // time, so a single id selector is enough rather than a per-day map.
  const [batchImportDayId, setBatchImportDayId] = useState<string | null>(null);
  const [batchDraft, setBatchDraft] = useState('');

  // ── Week expand/collapse + tab navigation ────────────────────────────────
  // Tracks which week cards are expanded. On mount we open the first week
  // with at least one unlogged day so coaches land where they're actively
  // editing — falling back to week 1 if the whole program is already
  // logged. Lazy initializer so this only runs once per mount.
  const [expandedWeekIds, setExpandedWeekIds] = useState<Set<string>>(() => {
    const firstActive = program.weeks
      .slice()
      .sort((a, b) => a.weekNumber - b.weekNumber)
      .find((w) => w.days.some((d) => !d.loggedAt));
    return new Set(
      firstActive
        ? [firstActive.id]
        : program.weeks[0]
          ? [program.weeks[0].id]
          : [],
    );
  });
  // weekId → DOM element for the per-week wrapper, used by scrollToWeek to
  // jump from the sticky tab bar to the target card.
  const weekRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const toggleWeek = (weekId: string) => {
    setExpandedWeekIds((prev) => {
      const next = new Set(prev);
      if (next.has(weekId)) next.delete(weekId);
      else next.add(weekId);
      return next;
    });
  };

  const scrollToWeek = (weekId: string) => {
    const el = weekRefs.current[weekId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Tab-bar click always reveals: if the target week was collapsed,
    // expand it so the coach sees content after the scroll lands.
    setExpandedWeekIds((prev) => {
      if (prev.has(weekId)) return prev;
      const next = new Set(prev);
      next.add(weekId);
      return next;
    });
  };
  // Drag-driven save indicator. Keyed on the day where the drop landed so
  // only that day's header flashes the badge — avoids "Saving..." appearing
  // on every visible day at once.
  const [saveStatus, setSaveStatus] = useState<{
    dayId: string | null;
    status: 'idle' | 'saving' | 'saved';
  }>({ dayId: null, status: 'idle' });

  // Coach exercise library — globals + the coach's own additions. Mounted
  // here so the Combo Box in every row reads from one shared, cached list
  // rather than each input issuing its own fetch.
  const { exercises: libraryExercises, addExerciseToLibrary } = useExerciseLibrary();

  // dnd-kit sensors: pointer covers mouse, touch covers fingers (with a
  // 150ms long-press so the page can still scroll), keyboard wires up the
  // Tab/Space/Arrow flow that screen-reader users rely on. The pointer
  // 8px activation distance prevents accidental drags when a coach
  // intends to click the grip.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const allCols = program.columns ?? DEFAULT_COLUMNS;

  /** Flash the drag-save indicator on the targeted day's header. Saving →
   *  Saved at 600ms (matches the debounced save in AdminView), auto-hide
   *  after another 2s. Guards each transition against newer events so a
   *  rapid second drag doesn't get prematurely cleared by the first
   *  drop's trailing timeout. */
  const flashSave = (dayId: string) => {
    setSaveStatus({ dayId, status: 'saving' });
    setTimeout(() => {
      setSaveStatus((cur) =>
        cur.dayId === dayId && cur.status === 'saving' ? { dayId, status: 'saved' } : cur,
      );
    }, 600);
    setTimeout(() => {
      setSaveStatus((cur) =>
        cur.dayId === dayId && cur.status === 'saved' ? { dayId: null, status: 'idle' } : cur,
      );
    }, 2600);
  };

  // ── Column ops ──────────────────────────────────────────────────────────

  const openAddColumn = () => { setEditingColumn(null); setColumnModalOpen(true); };
  const openEditColumn = (col: ProgramColumn) => { setEditingColumn(col); setColumnModalOpen(true); };

  // Fields that ExercisePlan reads directly by name. A custom column whose
  // id collides with one of these would be treated as a built-in actual field
  // by the propagation logic, breaking cross-week sync silently. We suffix
  // any colliding UUID with '_custom' so the generated id can never be in
  // this set — the label is unaffected and is what the coach sees in the UI.
  const RESERVED_COLUMN_IDS = new Set([
    'sets', 'reps', 'expectedRpe', 'weightRange',
    'actualLoad', 'actualRpe', 'notes', 'videoUrl',
  ]);

  const handleSaveColumn = (label: string, type: 'plan' | 'actual') => {
    let updated: ProgramColumn[];
    if (editingColumn) {
      updated = allCols.map((c) => c.id === editingColumn.id ? { ...c, label, type } : c);
    } else {
      let id = crypto.randomUUID();
      // UUID v4 never coincidentally matches a plain English word, but guard
      // defensively so future id-generation strategies can't introduce a collision.
      if (RESERVED_COLUMN_IDS.has(id)) id = `${id}_custom`;
      const newCol: ProgramColumn = { id, label, type };
      updated = [...allCols, newCol];
    }
    onChange({ ...program, columns: updated });
    setColumnModalOpen(false);
  };

  const deleteColumn = (colId: string) => {
    // Strip the column AND any orphaned values keyed by it across every exercise.
    // Without this, deleted custom columns leave ghost data in localStorage forever.
    const LEGACY_FIELDS = RESERVED_COLUMN_IDS;

    const stripExercise = (ex: ExercisePlan): ExercisePlan => {
      const next: ExercisePlan = { ...ex };
      if (LEGACY_FIELDS.has(colId)) {
        delete (next as unknown as Record<string, unknown>)[colId];
      }
      if (next.values && colId in next.values) {
        const cleaned = { ...next.values };
        delete cleaned[colId];
        next.values = cleaned;
      }
      return next;
    };

    onChange({
      ...program,
      columns: allCols.filter((c) => c.id !== colId),
      weeks: program.weeks.map((w) => ({
        ...w,
        days: w.days.map((d) => ({
          ...d,
          exercises: d.exercises.map(stripExercise),
        })),
      })),
    });
  };

  // ── Week ops ────────────────────────────────────────────────────────────

  const addWeek = () => {
    const nextNum = program.weeks.length + 1;
    const newWeek = {
      id: crypto.randomUUID(),
      weekNumber: nextNum,
      days: program.weeks.length > 0
        ? program.weeks[0].days.map((d) => ({
            ...d,
            id: crypto.randomUUID(),
            exercises: d.exercises.map((ex) => ({
              ...ex,
              id: crypto.randomUUID(),
              actualLoad: '', actualRpe: '', notes: '', videoUrl: '', values: {},
            })),
          }))
        : [],
    };
    onChange({ ...program, weeks: [...program.weeks, newWeek] });
  };

  const deleteWeek = (weekId: string) => {
    onChange({
      ...program,
      weeks: program.weeks
        .filter((w) => w.id !== weekId)
        .map((w, i) => ({ ...w, weekNumber: i + 1 })),
    });
  };

  // ── Day ops ─────────────────────────────────────────────────────────────

  const addDay = (weekId: string) => {
    const week = program.weeks.find((w) => w.id === weekId);
    const nextDayNum = (week?.days.length ?? 0) + 1;
    const newDay = {
      id: crypto.randomUUID(),
      dayNumber: nextDayNum,
      name: 'New Workout',
      exercises: [],
    };
    // Sync: add the same day slot to all weeks
    onChange({
      ...program,
      weeks: program.weeks.map((w) => ({
        ...w,
        days: [...w.days, { ...newDay, id: crypto.randomUUID() }],
      })),
    });
  };

  const deleteDay = (weekId: string, dayId: string) => {
    const dayNum = program.weeks.find((w) => w.id === weekId)?.days.find((d) => d.id === dayId)?.dayNumber;
    if (dayNum == null) return;
    onChange({
      ...program,
      weeks: program.weeks.map((w) => ({
        ...w,
        days: w.days.filter((d) => d.dayNumber !== dayNum),
      })),
    });
  };

  const updateDayName = (dayNumber: number, name: string) => {
    onChange({
      ...program,
      weeks: program.weeks.map((w) => ({
        ...w,
        days: w.days.map((d) => d.dayNumber === dayNumber ? { ...d, name } : d),
      })),
    });
  };

  // ── Exercise ops ────────────────────────────────────────────────────────

  const addExercise = (weekId: string, dayId: string) => {
    const day = program.weeks.find((w) => w.id === weekId)?.days.find((d) => d.id === dayId);
    if (!day) return;
    const newEx: ExercisePlan = {
      id: crypto.randomUUID(),
      exerciseId: 'new',
      exerciseName: 'New Exercise',
      sets: 3,
      reps: '10',
      values: {},
    };
    // Sync: add exercise at same day slot across all weeks
    onChange({
      ...program,
      weeks: program.weeks.map((w) => ({
        ...w,
        days: w.days.map((d) =>
          d.dayNumber === day.dayNumber
            ? { ...d, exercises: [...d.exercises, { ...newEx, id: crypto.randomUUID() }] }
            : d
        ),
      })),
    });
  };

  const updateExercise = (
    weekId: string,
    dayId: string,
    exId: string,
    field: string,
    rawValue: string
  ) => {
    const day = program.weeks.find((w) => w.id === weekId)?.days.find((d) => d.id === dayId);
    if (!day) return;
    const exIndex = day.exercises.findIndex((ex) => ex.id === exId);
    if (exIndex === -1) return;

    // Sanitize numeric plan/actual columns. Free-text columns (exerciseName,
    // weightRange like "70-80kg", custom UUID columns, notes) flow through
    // unchanged. Without this, a coach could type "9999999" into the sets
    // column and the trainee would inherit the garbage.
    const kind = kindForColumnId(field);
    const value = kind ? sanitizeOnType(rawValue, kind) : rawValue;

    const legacyFields = ['exerciseName', 'sets', 'reps', 'expectedRpe', 'weightRange'];
    const isPlanField = !['actualLoad', 'actualRpe', 'notes', 'videoUrl'].includes(field);

    onChange({
      ...program,
      weeks: program.weeks.map((w) => ({
        ...w,
        days: w.days.map((d) =>
          d.dayNumber === day.dayNumber
            ? {
                ...d,
                exercises: d.exercises.map((ex, idx) => {
                  if (isPlanField && idx === exIndex) {
                    if (legacyFields.includes(field)) return { ...ex, [field]: value };
                    return { ...ex, values: { ...(ex.values ?? {}), [field]: value } };
                  }
                  // Actual fields: only update the specific instance
                  if (!isPlanField && w.id === weekId && d.id === dayId && ex.id === exId) {
                    return { ...ex, [field]: value };
                  }
                  return ex;
                }),
              }
            : d
        ),
      })),
    });
  };

  /**
   * Atomic name + videoUrl swap for the exercise-library Combo Box pick.
   *
   * `updateExercise` only handles one field per call, and React state
   * updates inside a single tick can race — calling it twice in a row to
   * set name then videoUrl would lose one of the two values when the
   * second call reads the pre-first-call `program` from the closure.
   *
   * Mirrors the propagation rule in `updateExercise`: `exerciseName` is a
   * plan field (every day with the matching `dayNumber` and exercise
   * index gets the new name), while `videoUrl` is per-instance — the
   * coach's video link only attaches to the row they picked from. That
   * keeps trainee-uploaded session videos (which also live on videoUrl)
   * from being clobbered across other weeks.
   */
  const selectExerciseFromLibrary = (
    weekId: string,
    dayId: string,
    exId: string,
    name: string,
    videoUrl: string | undefined,
  ) => {
    const day = program.weeks.find((w) => w.id === weekId)?.days.find((d) => d.id === dayId);
    if (!day) return;
    const exIndex = day.exercises.findIndex((ex) => ex.id === exId);
    if (exIndex === -1) return;

    onChange({
      ...program,
      weeks: program.weeks.map((w) => ({
        ...w,
        days: w.days.map((d) =>
          d.dayNumber === day.dayNumber
            ? {
                ...d,
                exercises: d.exercises.map((ex, idx) => {
                  if (idx !== exIndex) return ex;
                  // Plan-field propagation: every same-position row in
                  // every week of the dayNumber gets the name.
                  const next = { ...ex, exerciseName: name };
                  // Per-instance: only the actual row the coach picked
                  // from gets the videoUrl assignment.
                  if (w.id === weekId && d.id === dayId && ex.id === exId) {
                    next.videoUrl = videoUrl;
                  }
                  return next;
                }),
              }
            : d,
        ),
      })),
    });
  };

  /** Final clamp on blur for numeric program-editor cells. Without this, a
   *  coach who types "0" into RPE and tabs away leaves it below the 1.0
   *  floor. Free-text columns get no-op'd. */
  const commitExerciseField = (
    weekId: string,
    dayId: string,
    exId: string,
    field: string,
    raw: string,
  ) => {
    const kind = kindForColumnId(field);
    if (!kind) return;
    const cleaned = clampOnCommit(raw, kind);
    if (cleaned !== raw) updateExercise(weekId, dayId, exId, field, cleaned);
  };

  const deleteExercise = (weekId: string, dayId: string, exId: string) => {
    const day = program.weeks.find((w) => w.id === weekId)?.days.find((d) => d.id === dayId);
    if (!day) return;
    const exIndex = day.exercises.findIndex((ex) => ex.id === exId);
    onChange({
      ...program,
      weeks: program.weeks.map((w) => ({
        ...w,
        days: w.days.map((d) =>
          d.dayNumber === day.dayNumber
            ? { ...d, exercises: d.exercises.filter((_, i) => i !== exIndex) }
            : d
        ),
      })),
    });
  };

  /** Swap exercise at `fromIdx` with the one at `toIdx` within a specific
   *  week+day. Unlike add/delete, reordering is intentionally per-day-per-week
   *  so the coach can tune each week's sequencing independently. */
  const reorderExercise = (weekId: string, dayId: string, fromIdx: number, toIdx: number) => {
    onChange({
      ...program,
      weeks: program.weeks.map((w) => {
        if (w.id !== weekId) return w;
        return {
          ...w,
          days: w.days.map((d) => {
            if (d.id !== dayId) return d;
            const exercises = [...d.exercises];
            const [moved] = exercises.splice(fromIdx, 1);
            exercises.splice(toIdx, 0, moved);
            return { ...d, exercises };
          }),
        };
      }),
    });
  };

  /** Day reordering swaps `dayNumber` between two days *across every week*.
   *  `dayNumber` is the structural identity used to align Day-N across weeks
   *  (analytics, smart-resume, history modal all key off it), so swapping
   *  only inside the visible week would scramble that alignment. We swap the
   *  day records AND their `dayNumber` values in lockstep so the slot a
   *  given day occupied keeps its number — only the contents move. */
  const reorderDay = (fromDayNumber: number, toDayNumber: number) => {
    onChange({
      ...program,
      weeks: program.weeks.map((w) => {
        const days = [...w.days];
        const fromIdx = days.findIndex((d) => d.dayNumber === fromDayNumber);
        const toIdx = days.findIndex((d) => d.dayNumber === toDayNumber);
        if (fromIdx === -1 || toIdx === -1) return w;
        const updatedDays = days.map((d, i) => {
          if (i === fromIdx) return { ...days[toIdx], dayNumber: fromDayNumber };
          if (i === toIdx) return { ...days[fromIdx], dayNumber: toDayNumber };
          return d;
        });
        return { ...w, days: updatedDays };
      }),
    });
  };

  // ── Drag-end handlers ───────────────────────────────────────────────────

  const handleExerciseDragEnd = (event: DragEndEvent, week: WorkoutWeek, day: WorkoutDay) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIdx = day.exercises.findIndex((e) => e.id === active.id);
    const toIdx = day.exercises.findIndex((e) => e.id === over.id);
    if (fromIdx === -1 || toIdx === -1) return;
    reorderExercise(week.id, day.id, fromIdx, toIdx);
    flashSave(day.id);
  };

  const handleDayDragEnd = (event: DragEndEvent, week: WorkoutWeek) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromDay = week.days.find((d) => d.id === active.id);
    const toDay = week.days.find((d) => d.id === over.id);
    if (!fromDay || !toDay) return;
    reorderDay(fromDay.dayNumber, toDay.dayNumber);
    // Tag the indicator on the day that *moved*; after the swap its id is
    // still the same record, so this is the row the coach grabbed.
    flashSave(fromDay.id);
  };

  // ── Render ──────────────────────────────────────────────────────────────

  // Leading 56px column holds the drag handle + the up/down reorder buttons
  // (kept as a keyboard/accessibility fallback). Trailing 40px holds delete.
  const gridTemplate = `56px minmax(200px, 2fr) ${allCols.map(() => 'minmax(100px, 1fr)').join(' ')} 40px`;

  // Sort once per render — the tab bar AND the weeks list both render in
  // weekNumber order even if the underlying array is insertion-ordered.
  const sortedWeeks = [...program.weeks].sort((a, b) => a.weekNumber - b.weekNumber);

  return (
    <>
      {/* Toolbar */}
      <div className="flex justify-between items-center bg-card p-6 border border-border shadow-sm">
        <div className="flex items-center space-x-4 min-w-0">
          <Edit3 className="w-6 h-6 text-muted-foreground shrink-0" />
          <input
            value={program.name}
            onChange={(e) => onChange({ ...program, name: e.target.value })}
            maxLength={150}
            title={program.name}
            className="text-3xl font-bold italic font-serif bg-transparent border-none outline-none focus:ring-0 p-0 text-foreground overflow-hidden text-ellipsis whitespace-nowrap min-w-0"
          />
          {onSaveAsTemplate && (
            <button
              onClick={() => setSaveTemplateOpen(true)}
              data-testid="save-as-template-btn"
              title="Save this program structure as a reusable template"
              className="shrink-0 flex items-center gap-1.5 border border-border text-muted-foreground hover:border-foreground hover:text-foreground px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              Save as Template
            </button>
          )}
        </div>
        <div className="flex space-x-3">
          <Button variant="ghost" size="sm" onClick={openAddColumn} data-testid="add-column-btn">
            + Column
          </Button>
          <Button variant="primary" size="sm" onClick={addWeek}>
            + Week
          </Button>
        </div>
      </div>

      {/* Sticky week-jump tab bar — horizontally scrollable on narrow
          viewports so a 12+ week block doesn't blow out the row. The active
          tab corresponds to the currently-expanded week; clicking jumps the
          scroll and force-expands the target. */}
      <div className="sticky top-0 z-30 -mx-8 px-8 py-3 bg-background/95 backdrop-blur-md border-b border-primary/20 flex items-center gap-1 overflow-x-auto no-scrollbar mb-6">
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mr-2 shrink-0">
          Jump to:
        </span>
        {sortedWeeks.map((w) => {
          const isActive = expandedWeekIds.has(w.id);
          const logged = w.days.filter((d) => d.loggedAt).length;
          const total = w.days.length;
          const complete = total > 0 && logged === total;
          return (
            <button
              key={w.id}
              onClick={() => scrollToWeek(w.id)}
              data-testid={`week-tab-${w.weekNumber}`}
              className={cn(
                'px-2.5 py-1 text-[11px] font-mono tabular-nums border transition-colors shrink-0',
                isActive
                  ? 'border-primary text-primary bg-primary/10'
                  : 'border-border/50 text-muted-foreground hover:border-primary/40 hover:text-primary',
                complete && !isActive && 'border-accent/40 text-accent',
              )}
              title={`Week ${w.weekNumber} — ${logged}/${total} days logged`}
            >
              W{w.weekNumber}
            </button>
          );
        })}
      </div>

      {/* Weeks */}
      <div className="space-y-8">
        {sortedWeeks.map((week) => {
          const isExpanded = expandedWeekIds.has(week.id);
          const loggedCount = week.days.filter((d) => d.loggedAt).length;
          const totalDays = week.days.length;
          return (
          <div
            key={week.id}
            ref={(el) => { weekRefs.current[week.id] = el; }}
            data-testid={`week-card-${week.weekNumber}`}
          >
          <TechnicalCard className="overflow-visible">
            {/* Clickable header — always visible. Toggles the body via
                AnimatePresence so the per-week DndContext stays mounted
                inside the (height: 0) wrapper rather than being unmounted. */}
            <button
              type="button"
              onClick={() => toggleWeek(week.id)}
              className="w-full flex justify-between items-center px-8 py-4 hover:bg-primary/5 transition-colors"
              data-testid={`week-header-${week.weekNumber}`}
              aria-expanded={isExpanded}
            >
              <div className="flex items-center gap-3">
                {isExpanded
                  ? <ChevronDown className="w-4 h-4 text-primary" />
                  : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                <h3 className="text-sm font-mono font-bold uppercase tracking-[0.25em] text-primary">
                  WEEK {week.weekNumber}
                </h3>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                {totalDays} day{totalDays !== 1 ? 's' : ''} · {loggedCount}/{totalDays} logged
              </span>
            </button>

            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="px-8 pb-8">
            {/* Week header */}
            <div className="flex justify-between items-center mb-8 border-b border-border pb-6">
              <div className="flex items-center space-x-4">
                <h3 className="text-sm font-mono font-bold uppercase tracking-[0.25em] text-primary">
                  WEEK {week.weekNumber}
                </h3>
                <button
                  onClick={() => deleteWeek(week.id)}
                  className="text-muted-foreground hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => addDay(week.id)}>
                + Day
              </Button>
            </div>

            {/* Days — wrapped in DndContext per-week so day drags are scoped to
                their visible week. The underlying reorderDay swaps dayNumbers
                across every week atomically, so the visual cross-week sync
                falls out for free. */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(event) => handleDayDragEnd(event, week)}
            >
              <SortableContext
                items={week.days.map((d) => d.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-12">
                  {week.days.map((day) => {
                    // Position lookup is per-render: the sorted index drives
                    // the up/down disabled state so the first/last days can't
                    // move past their bounds.
                    const sortedDays = [...week.days].sort((a, b) => a.dayNumber - b.dayNumber);
                    const dayIdx = sortedDays.findIndex((d) => d.dayNumber === day.dayNumber);
                    const isFirst = dayIdx === 0;
                    const isLast = dayIdx === sortedDays.length - 1;

                    return (
                      <SortableShell key={day.id} id={day.id}>
                        {({ setNodeRef, style, handleProps, isDragging, isOver }) => (
                          <div
                            ref={setNodeRef}
                            style={style}
                            data-testid={`day-card-${day.dayNumber}`}
                            className={cn(
                              'space-y-6 bg-surface/30 p-6 border transition-colors',
                              isDragging && 'opacity-50',
                              isOver ? 'border-primary/60' : 'border-border/40',
                            )}
                          >
                            {/* Day header */}
                            <div className="flex justify-between items-center">
                              <div className="flex items-center space-x-4">
                                {/* Drag handle — primary affordance. dnd-kit
                                    attaches both pointer and keyboard listeners
                                    here, so Tab + Space lifts the card. */}
                                <button
                                  {...handleProps}
                                  type="button"
                                  aria-label={`Drag day ${day.dayNumber}`}
                                  data-testid={`day-drag-handle-${day.dayNumber}`}
                                  className={cn(
                                    'text-muted-foreground hover:text-primary transition-colors',
                                    isDragging ? 'cursor-grabbing' : 'cursor-grab',
                                  )}
                                >
                                  <GripVertical className="w-4 h-4" />
                                </button>
                                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                                  Day {day.dayNumber}
                                  {day.loggedAt && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block ml-2" title="Session logged" />
                                  )}
                                </span>
                                <input
                                  value={day.name}
                                  onChange={(e) => updateDayName(day.dayNumber, e.target.value)}
                                  maxLength={150}
                                  title={day.name}
                                  className="bg-transparent border-none outline-none text-base font-display font-semibold uppercase tracking-widest text-foreground focus:ring-0 p-0 w-64 overflow-hidden text-ellipsis whitespace-nowrap"
                                />
                                {/* Drag-driven save indicator */}
                                {saveStatus.dayId === day.id && saveStatus.status !== 'idle' && (
                                  <span
                                    data-testid={`save-status-${day.dayNumber}`}
                                    className={cn(
                                      'font-mono text-[9px] uppercase tracking-widest',
                                      saveStatus.status === 'saving' ? 'text-warning' : 'text-accent',
                                    )}
                                  >
                                    {saveStatus.status === 'saving' ? 'Saving...' : '✓ Saved'}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center space-x-4">
                                {/* Up/down fallback — kept for keyboard /
                                    screen-reader users and one-click reordering. */}
                                <button
                                  onClick={() => !isFirst && reorderDay(day.dayNumber, sortedDays[dayIdx - 1].dayNumber)}
                                  disabled={isFirst}
                                  className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                  title="Move day up"
                                  data-testid={`day-up-btn-${day.dayNumber}`}
                                >
                                  <ChevronUp className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => !isLast && reorderDay(day.dayNumber, sortedDays[dayIdx + 1].dayNumber)}
                                  disabled={isLast}
                                  className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                  title="Move day down"
                                  data-testid={`day-down-btn-${day.dayNumber}`}
                                >
                                  <ChevronDown className="w-4 h-4" />
                                </button>
                                <Button variant="ghost" size="sm" onClick={() => addExercise(week.id, day.id)}>
                                  + Exercise
                                </Button>
                                <button
                                  onClick={() => { setBatchImportDayId(day.id); setBatchDraft(''); }}
                                  className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
                                  data-testid={`batch-import-btn-${day.id}`}
                                >
                                  + Batch
                                </button>
                                <button
                                  onClick={() => deleteDay(week.id, day.id)}
                                  className="text-muted-foreground hover:text-red-500"
                                >
                                  <X className="w-5 h-5" />
                                </button>
                              </div>
                            </div>

                            {/* Batch-import panel — paste a newline-separated list of
                                exercise names. The submit handler propagates each one
                                across every week's matching day (same as addExercise),
                                regenerating ids per week so DB rows don't collide. */}
                            {batchImportDayId === day.id && (() => {
                              const parsedNames = batchDraft
                                .split('\n')
                                .map((n) => n.trim())
                                .filter((n) => n.length > 0);
                              return (
                                <div
                                  className="mx-4 mb-4 p-4 bg-surface border border-primary/20 space-y-3"
                                  data-testid={`batch-import-panel-${day.id}`}
                                >
                                  <p className="text-[10px] font-mono uppercase tracking-widest text-primary/60">
                                    Paste exercise names — one per line
                                  </p>
                                  <textarea
                                    value={batchDraft}
                                    onChange={(e) => setBatchDraft(e.target.value)}
                                    placeholder={'Back Squat\nRomanian Deadlift\nLeg Press'}
                                    rows={5}
                                    className="w-full bg-transparent border-b border-primary/30 focus:border-primary p-2 font-mono text-sm text-foreground outline-none resize-none placeholder:text-muted-foreground/30 transition-colors"
                                    autoFocus
                                  />
                                  <div className="flex gap-2 justify-end">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setBatchImportDayId(null)}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      disabled={parsedNames.length === 0}
                                      data-testid="batch-import-confirm"
                                      onClick={() => {
                                        if (parsedNames.length === 0) return;
                                        const newExercises = parsedNames.map((name) => ({
                                          id: crypto.randomUUID(),
                                          exerciseId: name.toLowerCase().replace(/\s+/g, '_'),
                                          exerciseName: name,
                                          sets: 3,
                                          reps: '',
                                          expectedRpe: '',
                                          weightRange: '',
                                          actualLoad: '',
                                          actualRpe: '',
                                          notes: '',
                                          videoUrl: '',
                                          values: {} as Record<string, string>,
                                        }));
                                        onChange({
                                          ...program,
                                          weeks: program.weeks.map((w) => ({
                                            ...w,
                                            // Match by dayNumber so the import lands at
                                            // the same slot in every week — mirroring
                                            // the cross-week behaviour of addExercise.
                                            days: w.days.map((d) =>
                                              d.dayNumber === day.dayNumber
                                                ? {
                                                    ...d,
                                                    exercises: [
                                                      ...d.exercises,
                                                      ...newExercises.map((ex) => ({
                                                        ...ex,
                                                        id: crypto.randomUUID(),
                                                      })),
                                                    ],
                                                  }
                                                : d,
                                            ),
                                          })),
                                        });
                                        setBatchImportDayId(null);
                                        setBatchDraft('');
                                      }}
                                    >
                                      Add {parsedNames.length} Exercise{parsedNames.length !== 1 ? 's' : ''}
                                    </Button>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Exercise grid */}
                            <div className="overflow-x-auto pb-4">
                              <div className="min-w-[800px]">
                                {/* Column header row */}
                                <div
                                  className="grid gap-4 px-4 text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2 pt-6"
                                  style={{ gridTemplateColumns: gridTemplate }}
                                >
                                  <span />
                                  <span>Exercise Name</span>
                                  {allCols.map((col) => (
                                    <div
                                      key={col.id}
                                      className="text-center group relative flex items-center justify-center min-h-[32px]"
                                    >
                                      <span className={cn(col.type === 'actual' ? 'text-primary/60' : '')}>
                                        {col.label}
                                        {col.type === 'actual' && (
                                          <span className="ml-1 text-[8px] text-primary/40">(ACT)</span>
                                        )}
                                      </span>
                                      {/* Edit/delete column controls */}
                                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                                        <button
                                          onClick={() => openEditColumn(col)}
                                          className="text-primary bg-surface rounded-full p-1.5 shadow-md hover:bg-primary/10 border border-primary/20"
                                          title="Edit Column"
                                        >
                                          <Edit3 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={() => deleteColumn(col.id)}
                                          className="text-danger bg-surface rounded-full p-1.5 shadow-md hover:bg-danger/10 border border-danger/20"
                                          title="Delete Column"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                  <span />
                                </div>

                                {/* Exercise rows — nested DndContext scoped to
                                    this day's list. Per-day-per-week reordering
                                    matches the existing splice-in-place semantics
                                    (other weeks of the same dayNumber stay put). */}
                                <DndContext
                                  sensors={sensors}
                                  collisionDetection={closestCenter}
                                  onDragEnd={(event) => handleExerciseDragEnd(event, week, day)}
                                >
                                  <SortableContext
                                    items={day.exercises.map((e) => e.id)}
                                    strategy={verticalListSortingStrategy}
                                  >
                                    <div className="space-y-2">
                                      {day.exercises.map((ex, exIdx) => (
                                        <SortableShell key={ex.id} id={ex.id}>
                                          {({ setNodeRef, style, handleProps, isDragging, isOver }) => (
                                            <div
                                              ref={setNodeRef}
                                              style={{ ...style, gridTemplateColumns: gridTemplate }}
                                              data-testid={`exercise-row-${exIdx}`}
                                              className={cn(
                                                'grid gap-4 items-center bg-card/50 p-3 border transition-colors group',
                                                isDragging && 'opacity-50',
                                                isOver ? 'border-primary/60' : 'border-border hover:border-primary/40',
                                              )}
                                            >
                                              {/* Grip handle + chevron stack share the leading 56px column. */}
                                              <div className="flex items-center justify-center gap-1">
                                                <button
                                                  {...handleProps}
                                                  type="button"
                                                  aria-label={`Drag ${ex.exerciseName}`}
                                                  data-testid={`exercise-drag-handle-${exIdx}`}
                                                  className={cn(
                                                    'text-muted-foreground hover:text-primary transition-colors',
                                                    isDragging ? 'cursor-grabbing' : 'cursor-grab',
                                                  )}
                                                >
                                                  <GripVertical className="w-4 h-4" />
                                                </button>
                                                <div className="flex flex-col items-center justify-center gap-0.5">
                                                  <button
                                                    type="button"
                                                    onClick={() => reorderExercise(week.id, day.id, exIdx, exIdx - 1)}
                                                    disabled={exIdx === 0}
                                                    className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                                  >
                                                    <ChevronUp className="w-4 h-4" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => reorderExercise(week.id, day.id, exIdx, exIdx + 1)}
                                                    disabled={exIdx === day.exercises.length - 1}
                                                    className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                                  >
                                                    <ChevronDown className="w-4 h-4" />
                                                  </button>
                                                </div>
                                              </div>
                                              <ExerciseCombobox
                                                value={ex.exerciseName}
                                                onChange={(v) => updateExercise(week.id, day.id, ex.id, 'exerciseName', v)}
                                                onSelect={(name, videoUrl) =>
                                                  selectExerciseFromLibrary(week.id, day.id, ex.id, name, videoUrl)
                                                }
                                                onSaveToLibrary={async (name) => {
                                                  // Persist the row's current videoUrl alongside the name so
                                                  // future programs that pick this entry from the dropdown
                                                  // get the technique reference for free. If the row has no
                                                  // video yet, the entry saves with an empty url and the
                                                  // coach can attach one later by re-saving.
                                                  await addExerciseToLibrary(name, ex.videoUrl ?? '');
                                                }}
                                                exercises={libraryExercises}
                                                maxLength={150}
                                                title={ex.exerciseName}
                                                className="overflow-hidden text-ellipsis whitespace-nowrap"
                                              />

                                              {allCols.map((col) => {
                                                const cellValue = String(getExerciseValue(ex, col.id) ?? '');
                                                const colKind = kindForColumnId(col.id);
                                                const colRange = colKind ? RANGES[colKind] : null;
                                                return (
                                                  <div key={col.id} className="flex justify-center min-w-0">
                                                    {col.type === 'plan' ? (
                                                      <TechnicalInput
                                                        value={cellValue}
                                                        onChange={(val) =>
                                                          updateExercise(week.id, day.id, ex.id, col.id, val)
                                                        }
                                                        onBlur={
                                                          colKind
                                                            ? (val) => commitExerciseField(week.id, day.id, ex.id, col.id, val)
                                                            : undefined
                                                        }
                                                        // Numeric columns get a tighter character cap and the
                                                        // mobile decimal keypad. 6 chars holds "1000.0" / "100" /
                                                        // "20" / "10.5" comfortably.
                                                        maxLength={colKind ? 6 : 150}
                                                        inputMode={colKind ? 'decimal' : undefined}
                                                        pattern={colKind ? '[0-9.]*' : undefined}
                                                        aria-valuemin={colRange?.min}
                                                        aria-valuemax={colRange?.max}
                                                        title={cellValue}
                                                        className="text-center overflow-hidden text-ellipsis whitespace-nowrap"
                                                        placeholder="..."
                                                      />
                                                    ) : cellValue ? (
                                                      <div
                                                        title={cellValue}
                                                        className="text-xs font-mono italic text-blue-400/80 text-center overflow-hidden text-ellipsis whitespace-nowrap select-text"
                                                      >
                                                        {cellValue}
                                                      </div>
                                                    ) : (
                                                      <div className="text-[10px] font-mono text-muted-foreground/30 italic">
                                                        Trainee Input
                                                      </div>
                                                    )}
                                                  </div>
                                                );
                                              })}

                                              <button
                                                onClick={() => deleteExercise(week.id, day.id, ex.id)}
                                                className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex justify-center"
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </button>
                                            </div>
                                          )}
                                        </SortableShell>
                                      ))}
                                    </div>
                                  </SortableContext>
                                </DndContext>
                              </div>
                            </div>
                          </div>
                        )}
                      </SortableShell>
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </TechnicalCard>
          </div>
          );
        })}
      </div>

      <ColumnModal
        isOpen={columnModalOpen}
        onClose={() => setColumnModalOpen(false)}
        editingColumn={editingColumn}
        onSave={handleSaveColumn}
      />

      {onSaveAsTemplate && (
        <SaveTemplateModal
          isOpen={saveTemplateOpen}
          initialName={program.name}
          onClose={() => setSaveTemplateOpen(false)}
          onSave={onSaveAsTemplate}
        />
      )}
    </>
  );
}

// ─── Sortable render-prop wrapper ───────────────────────────────────────────
//
// `useSortable` must be called from a component body, so each draggable
// row/card needs its own component. To avoid drilling 15+ closure-scoped
// handlers as props on every row, we expose drag mechanics through a
// render-prop and let the parent build the JSX inline against its existing
// closure — keeping the editor's branching logic in one place.

interface SortableRenderArgs {
  setNodeRef: (el: HTMLElement | null) => void;
  style: React.CSSProperties;
  /** Spread onto the drag-handle button. Combines dnd-kit's accessibility
   *  `attributes` (role, aria, tabindex) with the pointer/touch/keyboard
   *  `listeners` that actually start the drag. */
  handleProps: Record<string, unknown>;
  isDragging: boolean;
  isOver: boolean;
}

interface SortableShellProps {
  id: string;
  children: (args: SortableRenderArgs) => React.ReactNode;
}

function SortableShell({ id, children }: SortableShellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const handleProps = { ...attributes, ...(listeners ?? {}) };
  return <>{children({ setNodeRef, style, handleProps, isDragging, isOver })}</>;
}
