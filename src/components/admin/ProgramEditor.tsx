import { useState } from 'react';
import { Edit3, Trash2, X } from 'lucide-react';
import { TechnicalCard, TechnicalInput } from '../ui';
import { ColumnModal } from './ColumnModal';
import { cn } from '../../lib/utils';
import { DEFAULT_COLUMNS } from '../../constants/mockData';
import { sanitizeOnType, clampOnCommit, kindForColumnId, RANGES } from '../../lib/numericInput';
import type { Program, ProgramColumn, ExercisePlan } from '../../types';

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
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ProgramEditor({ program, onChange }: ProgramEditorProps) {
  const [columnModalOpen, setColumnModalOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<ProgramColumn | null>(null);

  const allCols = program.columns ?? DEFAULT_COLUMNS;

  // ── Column ops ──────────────────────────────────────────────────────────

  const openAddColumn = () => { setEditingColumn(null); setColumnModalOpen(true); };
  const openEditColumn = (col: ProgramColumn) => { setEditingColumn(col); setColumnModalOpen(true); };

  const handleSaveColumn = (label: string, type: 'plan' | 'actual') => {
    let updated: ProgramColumn[];
    if (editingColumn) {
      updated = allCols.map((c) => c.id === editingColumn.id ? { ...c, label, type } : c);
    } else {
      const newCol: ProgramColumn = { id: crypto.randomUUID(), label, type };
      updated = [...allCols, newCol];
    }
    onChange({ ...program, columns: updated });
    setColumnModalOpen(false);
  };

  const deleteColumn = (colId: string) => {
    // Strip the column AND any orphaned values keyed by it across every exercise.
    // Without this, deleted custom columns leave ghost data in localStorage forever.
    const LEGACY_FIELDS = new Set([
      'sets', 'reps', 'expectedRpe', 'weightRange',
      'actualLoad', 'actualRpe', 'notes', 'videoUrl',
    ]);

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

  // ── Render ──────────────────────────────────────────────────────────────

  const gridTemplate = `minmax(200px, 2fr) ${allCols.map(() => 'minmax(100px, 1fr)').join(' ')} 40px`;

  return (
    <>
      {/* Toolbar */}
      <div className="flex justify-between items-center bg-card p-6 border border-border shadow-sm">
        <div className="flex items-center space-x-4">
          <Edit3 className="w-6 h-6 text-muted-foreground" />
          <input
            value={program.name}
            onChange={(e) => onChange({ ...program, name: e.target.value })}
            maxLength={150}
            title={program.name}
            className="text-3xl font-bold italic font-serif bg-transparent border-none outline-none focus:ring-0 p-0 text-foreground overflow-hidden text-ellipsis whitespace-nowrap"
          />
        </div>
        <div className="flex space-x-3">
          <button
            onClick={openAddColumn}
            data-testid="add-column-btn"
            className="border border-foreground text-foreground px-6 py-3 text-xs font-bold uppercase tracking-widest hover:bg-foreground hover:text-background transition-all shadow-sm"
          >
            + Add Column
          </button>
          <button
            onClick={addWeek}
            className="bg-foreground text-background px-6 py-3 text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-md"
          >
            + Add Week
          </button>
        </div>
      </div>

      {/* Weeks */}
      <div className="space-y-8">
        {program.weeks.map((week) => (
          <TechnicalCard key={week.id} className="p-8 border-2">
            {/* Week header */}
            <div className="flex justify-between items-center mb-8 border-b border-border pb-6">
              <div className="flex items-center space-x-4">
                <h3 className="text-2xl font-bold font-mono tracking-tighter">
                  WEEK {week.weekNumber}
                </h3>
                <button
                  onClick={() => deleteWeek(week.id)}
                  className="text-muted-foreground hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
              <button
                onClick={() => addDay(week.id)}
                className="text-xs font-bold uppercase tracking-widest border border-foreground px-4 py-2 hover:bg-foreground hover:text-background transition-all"
              >
                + Add Day
              </button>
            </div>

            {/* Days */}
            <div className="space-y-12">
              {week.days.map((day) => (
                <div key={day.id} className="space-y-6 bg-muted/10 p-6 rounded-sm border border-border/50">
                  {/* Day header */}
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-4">
                      <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                        Day {day.dayNumber}
                      </span>
                      <input
                        value={day.name}
                        onChange={(e) => updateDayName(day.dayNumber, e.target.value)}
                        maxLength={150}
                        title={day.name}
                        className="bg-transparent border-none outline-none text-2xl font-bold italic font-serif text-foreground focus:ring-0 p-0 w-64 overflow-hidden text-ellipsis whitespace-nowrap"
                      />
                    </div>
                    <div className="flex items-center space-x-4">
                      <button
                        onClick={() => addExercise(week.id, day.id)}
                        className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground underline underline-offset-4"
                      >
                        + Add Exercise
                      </button>
                      <button
                        onClick={() => deleteDay(week.id, day.id)}
                        className="text-muted-foreground hover:text-red-500"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {/* Exercise grid */}
                  <div className="overflow-x-auto pb-4">
                    <div className="min-w-[800px]">
                      {/* Column header row */}
                      <div
                        className="grid gap-4 px-4 text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2 pt-6"
                        style={{ gridTemplateColumns: gridTemplate }}
                      >
                        <span>Exercise Name</span>
                        {allCols.map((col) => (
                          <div
                            key={col.id}
                            className="text-center group relative flex items-center justify-center min-h-[32px]"
                          >
                            <span className={cn(col.type === 'actual' ? 'text-blue-400/70' : '')}>
                              {col.label}
                              {col.type === 'actual' && (
                                <span className="ml-1 text-[8px] opacity-50">(ACT)</span>
                              )}
                            </span>
                            {/* Edit/delete column controls */}
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                              <button
                                onClick={() => openEditColumn(col)}
                                className="text-blue-500 bg-background rounded-full p-1.5 shadow-md hover:bg-blue-50 border border-blue-100"
                                title="Edit Column"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deleteColumn(col.id)}
                                className="text-red-500 bg-background rounded-full p-1.5 shadow-md hover:bg-red-50 border border-red-100"
                                title="Delete Column"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                        <span />
                      </div>

                      {/* Exercise rows */}
                      <div className="space-y-2">
                        {day.exercises.map((ex) => (
                          <div
                            key={ex.id}
                            className="grid gap-4 items-center bg-card p-3 border border-border hover:border-muted-foreground transition-all group shadow-sm"
                            style={{ gridTemplateColumns: gridTemplate }}
                          >
                            <TechnicalInput
                              value={ex.exerciseName}
                              onChange={(v) => updateExercise(week.id, day.id, ex.id, 'exerciseName', v)}
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
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </TechnicalCard>
        ))}
      </div>

      <ColumnModal
        isOpen={columnModalOpen}
        onClose={() => setColumnModalOpen(false)}
        editingColumn={editingColumn}
        onSave={handleSaveColumn}
      />
    </>
  );
}
