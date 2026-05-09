import { format, parseISO } from 'date-fns';
import { Modal } from '../ui';
import { cn } from '../../lib/utils';
import type { Program, WorkoutDay, ExercisePlan } from '../../types';

interface WorkoutHistoryModalProps {
  day: WorkoutDay;
  program: Program;
  onClose: () => void;
}

const DIFFICULTY_LABELS: Record<number, string> = {
  1: 'Trivial',
  2: 'Easy',
  3: 'Solid',
  4: 'Brutal',
  5: 'Maxed Out',
};

/** Build the prescribed summary string for an exercise row.
 *  Shows only non-empty fields so sparse plans don't render awkward "? × ?" text. */
function prescribedSummary(ex: ExercisePlan): string {
  const parts: string[] = [];
  if (ex.sets && ex.reps)         parts.push(`${ex.sets} × ${ex.reps}`);
  else if (ex.sets)               parts.push(`${ex.sets} sets`);
  else if (ex.reps)               parts.push(`${ex.reps} reps`);
  if (ex.weightRange)             parts.push(ex.weightRange);
  if (ex.expectedRpe)             parts.push(`@ RPE ${ex.expectedRpe}`);
  return parts.length > 0 ? parts.join(' ') : '—';
}

/**
 * Read-only drill-down modal. Shown when a trainee taps the eye icon on a
 * completed day card. Surfaces the full session record: exercise actuals,
 * custom column values, and the post-workout reflection if one was captured.
 */
export function WorkoutHistoryModal({ day, program, onClose }: WorkoutHistoryModalProps) {
  // Custom actual columns defined by the coach — rendered as extra rows for
  // each exercise when a value was logged.
  const actualCols = program.columns.filter((c) => c.type === 'actual');

  const formattedDate = day.loggedAt
    ? format(parseISO(day.loggedAt), 'EEEE, MMM d yyyy')
    : null;

  const hasReflection = !!day.difficulty || !!day.reflectionNote;

  return (
    <Modal isOpen title={day.name} onClose={onClose}>
      {/* The inner content is capped in height and scrolls so long sessions
          with many exercises don't overflow the viewport. */}
      <div className="space-y-6 max-h-[65vh] overflow-y-auto pr-1">
        {/* Date stamp */}
        {formattedDate && (
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground -mt-2">
            {formattedDate}
          </p>
        )}

        {/* Exercise list */}
        {day.exercises.length === 0 ? (
          <p className="text-xs font-mono text-muted-foreground text-center py-6">
            No exercises recorded.
          </p>
        ) : (
          <div className="space-y-4">
            {day.exercises.map((ex) => (
              <ExerciseBlock
                key={ex.id}
                ex={ex}
                actualCols={actualCols}
              />
            ))}
          </div>
        )}

        {/* Reflection section */}
        {hasReflection && (
          <section className="border-t border-border pt-4 space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Post-Workout Reflection
            </p>
            {day.difficulty != null && (
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Difficulty
                </span>
                <DifficultyBadge value={day.difficulty} />
              </div>
            )}
            {day.reflectionNote && (
              <p className="text-sm font-mono text-foreground/85 leading-relaxed whitespace-pre-wrap">
                {day.reflectionNote}
              </p>
            )}
          </section>
        )}

        {/* Coach feedback */}
        {day.coachNote && (
          <section className="border-t border-border pt-4 space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Coach Feedback
            </p>
            <p className="text-sm font-mono text-foreground leading-relaxed whitespace-pre-wrap">
              {day.coachNote}
            </p>
          </section>
        )}
      </div>
    </Modal>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

type ActualCol = Program['columns'][number];

function ExerciseBlock({
  ex,
  actualCols,
}: {
  ex: ExercisePlan;
  actualCols: ActualCol[];
}) {
  const customRows = actualCols
    .map((col) => ({ label: col.label, value: (ex.values?.[col.id] ?? '').trim() }))
    .filter(({ value }) => value !== '');

  return (
    <div className="border border-border">
      {/* Exercise name header */}
      <div className="px-3 py-2 bg-muted/30 border-b border-border">
        <span className="text-sm font-bold font-mono text-foreground">
          {ex.exerciseName}
        </span>
      </div>

      <div className="divide-y divide-border/50">
        {/* Prescribed */}
        <DataRow label="Prescribed" value={prescribedSummary(ex)} />

        {/* Actuals — always show, falling back to — */}
        <div className="grid grid-cols-2 divide-x divide-border/50">
          <DataRow label="Load" value={ex.actualLoad || '—'} />
          <DataRow label="RPE" value={ex.actualRpe || '—'} />
        </div>

        {/* Notes — omit entirely when empty */}
        {ex.notes && <DataRow label="Notes" value={ex.notes} />}

        {/* Custom actual columns */}
        {customRows.map(({ label, value }) => (
          <DataRow key={label} label={label} value={value} />
        ))}
      </div>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 px-3 py-1.5">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground shrink-0 w-20">
        {label}
      </span>
      <span className="text-xs font-mono text-foreground break-words">{value}</span>
    </div>
  );
}

function DifficultyBadge({ value }: { value: number }) {
  const label = DIFFICULTY_LABELS[value] ?? String(value);
  const tone =
    value <= 2 ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
    : value === 3 ? 'text-sky-400 border-sky-500/30 bg-sky-500/10'
    : value === 4 ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
    :               'text-red-400 border-red-500/30 bg-red-500/10';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest border',
        tone,
      )}
    >
      {value} · {label}
    </span>
  );
}
