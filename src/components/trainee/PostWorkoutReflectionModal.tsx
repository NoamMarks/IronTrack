import { useEffect, useState } from 'react';
import { Activity, Skull } from 'lucide-react';
import { Modal, Button } from '../ui';
import { cn } from '../../lib/utils';
import { hapticTick } from '../../lib/haptics';

const MAX_NOTE = 500;

const DIFFICULTY_LABELS: Record<number, string> = {
  1: 'Trivial',
  2: 'Easy',
  3: 'Solid',
  4: 'Brutal',
  5: 'Maxed',
};

const DIFFICULTY_ACTIVE: Record<number, string> = {
  1: 'bg-accent/20 text-accent border-t-2 border-accent',
  2: 'bg-accent/15 text-accent/80 border-t-2 border-accent/60',
  3: 'bg-primary/20 text-primary border-t-2 border-primary',
  4: 'bg-warning/20 text-warning border-t-2 border-warning',
  5: 'bg-danger/20 text-danger border-t-2 border-danger',
};

interface PostWorkoutReflectionModalProps {
  isOpen: boolean;
  /** Day the reflection is being submitted for. The component renders the
   *  day name in the header so the user knows which session they're rating. */
  dayName?: string;
  onSubmit: (difficulty: number, note: string) => void | Promise<void>;
  onSkip: () => void;
}

/**
 * Captured immediately after Finish Workout: a 1-5 difficulty pill row and
 * an optional 500-char note. "Skip" is a first-class option — we never want
 * to gate the post-workout flow behind another required input.
 */
export function PostWorkoutReflectionModal({
  isOpen,
  dayName,
  onSubmit,
  onSkip,
}: PostWorkoutReflectionModalProps) {
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset on each fresh open so a previous workout's answers don't bleed
  // into the next one.
  useEffect(() => {
    if (isOpen) {
      setDifficulty(null);
      setNote('');
      setSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (difficulty === null) return;
    setSubmitting(true);
    try {
      await onSubmit(difficulty, note.trim().slice(0, MAX_NOTE));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onSkip} title="Reflection">
      <div className="space-y-6" data-testid="reflection-modal">
        <div>
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            How did it feel?
          </p>
          {dayName && (
            <p className="text-xl font-display font-bold uppercase tracking-wide text-foreground mt-1 truncate">
              {dayName}
            </p>
          )}
        </div>

        {/* Difficulty pills — one tap commits the rating. */}
        <div className="space-y-2">
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Difficulty
          </label>
          <div className="grid grid-cols-5 gap-px bg-border" data-testid="reflection-difficulty">
            {[1, 2, 3, 4, 5].map((n) => {
              const active = difficulty === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    hapticTick();
                    setDifficulty(n);
                  }}
                  data-testid={`reflection-difficulty-${n}`}
                  aria-pressed={active}
                  className={cn(
                    'flex flex-col items-center justify-center py-3 transition-colors',
                    active
                      ? DIFFICULTY_ACTIVE[n]
                      : 'bg-surface text-muted-foreground hover:text-primary',
                  )}
                >
                  <span className="text-lg font-mono font-bold tabular-nums leading-none">{n}</span>
                  <span className="text-[9px] font-mono uppercase tracking-widest mt-1 opacity-80">
                    {DIFFICULTY_LABELS[n]}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground/70 uppercase tracking-widest pt-1">
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3" />
              In the tank
            </span>
            <span className="flex items-center gap-1">
              Maxed
              <Skull className="w-3 h-3" />
            </span>
          </div>
        </div>

        {/* Note — capped at 500 chars, optional. */}
        <div className="space-y-2">
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Note (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
            placeholder="Bar speed felt heavy, knees tracked well, RPE 9 honest..."
            data-testid="reflection-note"
            rows={3}
            className="w-full bg-surface border-b border-primary/30 p-3 text-sm font-mono text-foreground outline-none focus:border-primary resize-none placeholder:text-muted-foreground/60"
          />
          <p className="text-[9px] font-mono text-muted-foreground/60 text-right tabular-nums">
            {note.length} / {MAX_NOTE}
          </p>
        </div>

        {/* Actions — Skip is first-class, Submit is gated on difficulty
            being chosen so the rating is always meaningful when present. */}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="flex-1 py-3"
            onClick={onSkip}
            disabled={submitting}
            data-testid="reflection-skip-btn"
          >
            Skip
          </Button>
          <Button
            variant="primary"
            className="flex-[2] py-3"
            onClick={() => void handleSubmit()}
            disabled={difficulty === null || submitting}
            data-testid="reflection-submit-btn"
          >
            {submitting ? 'Saving...' : 'Save Reflection'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
