import { useState } from 'react';
import { cn } from '../../lib/utils';
import {
  sanitizeOnType,
  clampOnCommit,
  parseNumeric as parseNumericKind,
} from '../../lib/numericInput';

const RPE_OPTIONS = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10] as const;

function blockInvalidNumberKeys(e: React.KeyboardEvent<HTMLInputElement>) {
  if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
}

/**
 * RIR-adjusted Epley:
 *
 *   e1RM = weight × (1 + (reps + RIR) / 30)
 *
 * where `RIR = 10 - rpe` (reps in reserve). RPE 10 = 0 RIR (a true 1RM-style
 * grind), RPE 8 = 2 RIR, etc. This is the back-of-the-envelope formula every
 * RTS coach has scrawled on a whiteboard at some point — accurate enough for
 * a marketing playground without dragging in the full Tuchscherer chart.
 */
function rpeAdjustedE1RM(weight: number, reps: number, rpe: number): number | null {
  if (!Number.isFinite(weight) || weight <= 0) return null;
  if (!Number.isFinite(reps) || reps <= 0) return null;
  if (!Number.isFinite(rpe) || rpe < 5 || rpe > 10) return null;
  const rir = 10 - rpe;
  return Math.round(weight * (1 + (reps + rir) / 30) * 10) / 10;
}

export function RPECalculator() {
  const [weightInput, setWeightInput] = useState('100');
  const [repsInput, setRepsInput] = useState('5');
  const [rpe, setRpe] = useState<number>(8);

  const weight = parseNumericKind(weightInput, 'load') ?? 0;
  const reps = parseNumericKind(repsInput, 'reps') ?? 0;
  const e1rm = rpeAdjustedE1RM(weight, reps, rpe);

  const targets = e1rm
    ? [
        { label: '70%', value: Math.round(e1rm * 0.7 * 2) / 2 },
        { label: '80%', value: Math.round(e1rm * 0.8 * 2) / 2 },
        { label: '90%', value: Math.round(e1rm * 0.9 * 2) / 2 },
        { label: '95%', value: Math.round(e1rm * 0.95 * 2) / 2 },
      ]
    : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Weight (kg)
          </label>
          <div className="bg-muted/30 p-3 border border-border">
            <input
              type="text"
              inputMode="decimal"
              pattern="[0-9.]*"
              value={weightInput}
              onChange={(e) => setWeightInput(sanitizeOnType(e.target.value, 'load'))}
              onBlur={(e) => setWeightInput(clampOnCommit(e.target.value, 'load'))}
              onKeyDown={blockInvalidNumberKeys}
              placeholder="0"
              data-testid="rpe-weight"
              className="bg-transparent border-none outline-none focus:ring-0 text-foreground font-mono text-sm w-full text-center placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Reps
          </label>
          <div className="bg-muted/30 p-3 border border-border">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={repsInput}
              onChange={(e) => setRepsInput(sanitizeOnType(e.target.value, 'reps'))}
              onBlur={(e) => setRepsInput(clampOnCommit(e.target.value, 'reps'))}
              onKeyDown={blockInvalidNumberKeys}
              placeholder="0"
              data-testid="rpe-reps"
              className="bg-transparent border-none outline-none focus:ring-0 text-foreground font-mono text-sm w-full text-center placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </div>

      {/* RPE pill selector */}
      <div className="space-y-1">
        <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
          RPE
        </label>
        <div className="flex flex-wrap gap-1">
          {RPE_OPTIONS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setRpe(v)}
              data-testid={`rpe-pill-${v}`}
              aria-pressed={rpe === v}
              className={cn(
                'px-2.5 py-1.5 text-[11px] font-mono tabular-nums border transition-colors',
                rpe === v
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Result */}
      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Estimated 1RM
          </span>
          <span
            data-testid="rpe-e1rm"
            className="text-3xl font-bold font-serif italic text-foreground tabular-nums leading-none"
          >
            {e1rm ? `${e1rm} kg` : '—'}
          </span>
        </div>

        {targets && (
          <div className="grid grid-cols-4 gap-px bg-border">
            {targets.map((t) => (
              <div key={t.label} className="bg-card px-2 py-2 text-center">
                <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
                  {t.label}
                </p>
                <p className="text-sm font-mono text-foreground mt-0.5 tabular-nums">
                  {t.value} kg
                </p>
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] font-mono text-muted-foreground/80">
          RIR = {10 - rpe} • {reps + (10 - rpe)}-rep equivalent at RPE 10
        </p>
      </div>
    </div>
  );
}
