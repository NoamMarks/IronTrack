import { useEffect, useState } from 'react';
import { Activity, Skull } from 'lucide-react';
import { Modal } from '../ui';
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
            <p className="text-xl font-bold italic font-serif text-foreground mt-1 truncate">
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
                      ? 'bg-foreground text-background'
                      : 'bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className="text-lg font-bold tabular-nums leading-none">{n}</span>
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
            className="w-full bg-muted/30 border border-border p-3 text-sm font-mono text-foreground outline-none focus:border-muted-foreground resize-none placeholder:text-muted-foreground/60"
          />
          <p className="text-[9px] font-mono text-muted-foreground/60 text-right tabular-nums">
            {note.length} / {MAX_NOTE}
          </p>
        </div>

        {/* Actions — Skip is first-class, Submit is gated on difficulty
            being chosen so the rating is always meaningful when present. */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSkip}
            disabled={submitting}
            data-testid="reflection-skip-btn"
            className="flex-1 py-3 text-xs font-bold uppercase tracking-widest border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors disabled:opacity-40"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={difficulty === null || submitting}
            data-testid="reflection-submit-btn"
            className="btn-press flex-[2] py-3 text-xs font-bold uppercase tracking-widest bg-foreground text-background hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Saving...' : 'Save Reflection'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
