import { format, parseISO } from 'date-fns';
import { Modal } from '../ui';
import { cn } from '../../lib/utils';
import type { Program, WorkoutDay, ExercisePlan } from '../../types';

interface WorkoutHistoryModalProps {
  day: WorkoutDay;
  program: Program;
  onClose: () => void;
}

const BADGE_STYLES: Record<number, { bg: string; text: string; label: string }> = {
  1: { bg: 'bg-accent/15 border-accent/30',   text: 'text-accent',    label: 'Trivial' },
  2: { bg: 'bg-accent/10 border-accent/20',   text: 'text-accent/80', label: 'Easy'    },
  3: { bg: 'bg-primary/15 border-primary/30', text: 'text-primary',   label: 'Solid'   },
  4: { bg: 'bg-warning/15 border-warning/30', text: 'text-warning',   label: 'Brutal'  },
  5: { bg: 'bg-danger/15 border-danger/30',   text: 'text-danger',    label: 'Maxed'   },
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
      <div className="space-y-6 divide-y divide-primary/10 max-h-[65vh] overflow-y-auto pr-1">
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
          <section className="border-t border-primary/20 pt-4 space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
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
              <p className="text-sm font-mono text-foreground/90 leading-relaxed whitespace-pre-wrap">
                {day.reflectionNote}
              </p>
            )}
          </section>
        )}

        {/* Coach feedback */}
        {day.coachNote && (
          <section className="border-t border-primary/20 pt-4 space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-widest text-primary/60">
              Coach Feedback
            </p>
            <div className="border-l-2 border-primary/40 pl-3">
              <p className="text-sm font-mono text-foreground leading-relaxed whitespace-pre-wrap">
                {day.coachNote}
              </p>
            </div>
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
      <div className="px-3 py-2 bg-surface/60 border-b border-primary/20">
        <span className="font-display font-semibold uppercase tracking-wide text-foreground">
          {ex.exerciseName}
        </span>
      </div>

      <div className="divide-y divide-primary/15">
        {/* Prescribed */}
        <DataRow label="Prescribed" value={prescribedSummary(ex)} />

        {/* Actuals — always show, falling back to — */}
        <div className="grid grid-cols-2 divide-x divide-primary/15">
          <DataRow label="Load" value={ex.actualLoad || '—'} highlight={!!ex.actualLoad} />
          <DataRow label="RPE" value={ex.actualRpe || '—'} highlight={!!ex.actualRpe} />
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

function DataRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  const isEmpty = value === '—';
  return (
    <div className="flex gap-3 px-3 py-1.5 border-b border-border/20 last:border-0">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground shrink-0 w-20">
        {label}
      </span>
      <span className={cn(
        'text-xs font-mono break-words',
        isEmpty ? 'text-muted-foreground/40' : highlight ? 'text-primary' : 'text-foreground/80',
      )}>
        {value}
      </span>
    </div>
  );
}

function DifficultyBadge({ value }: { value: number }) {
  const style = BADGE_STYLES[value] ?? { bg: 'bg-muted border-border', text: 'text-muted-foreground', label: String(value) };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest border',
        style.bg,
        style.text,
      )}
    >
      {value} · {style.label}
    </span>
  );
}
