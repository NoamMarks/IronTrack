import { useState } from 'react';
import { cn } from '../../lib/utils';
import {
  sanitizeOnType,
  clampOnCommit,
  parseNumeric as parseNumericKind,
} from '../../lib/numericInput';
import { calculatePoints, strengthTier, type Gender } from '../../lib/formulas';

function blockInvalidNumberKeys(e: React.KeyboardEvent<HTMLInputElement>) {
  if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
}

export function PointsCalculator() {
  const [sex, setSex] = useState<Gender>('male');
  const [bodyweightInput, setBodyweightInput] = useState('80');
  const [totalInput, setTotalInput] = useState('500');

  const bw = parseNumericKind(bodyweightInput, 'load') ?? 0;
  const total = parseNumericKind(totalInput, 'load') ?? 0;
  const score = calculatePoints(bw, total, sex, 'dots');
  const tier = strengthTier(score);

  return (
    <div className="space-y-5">
      {/* Sex toggle */}
      <div className="space-y-1">
        <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
          Class
        </label>
        <div className="grid grid-cols-2 gap-px bg-border">
          {(['male', 'female'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSex(s)}
              data-testid={`points-sex-${s === 'male' ? 'M' : 'F'}`}
              aria-pressed={sex === s}
              className={cn(
                'py-2 text-[11px] font-mono uppercase tracking-widest transition-colors',
                sex === s
                  ? 'bg-foreground text-background'
                  : 'bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {s === 'male' ? 'Men' : 'Women'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Bodyweight (kg)
          </label>
          <div className="bg-muted/30 p-3 border border-border">
            <input
              type="text"
              inputMode="decimal"
              pattern="[0-9.]*"
              value={bodyweightInput}
              onChange={(e) => setBodyweightInput(sanitizeOnType(e.target.value, 'load'))}
              onBlur={(e) => setBodyweightInput(clampOnCommit(e.target.value, 'load'))}
              onKeyDown={blockInvalidNumberKeys}
              placeholder="0"
              data-testid="points-bodyweight"
              className="bg-transparent border-none outline-none focus:ring-0 text-foreground font-mono text-sm w-full text-center placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Total (kg)
          </label>
          <div className="bg-muted/30 p-3 border border-border">
            <input
              type="text"
              inputMode="decimal"
              pattern="[0-9.]*"
              value={totalInput}
              onChange={(e) => setTotalInput(sanitizeOnType(e.target.value, 'load'))}
              onBlur={(e) => setTotalInput(clampOnCommit(e.target.value, 'load'))}
              onKeyDown={blockInvalidNumberKeys}
              placeholder="0"
              data-testid="points-total"
              className="bg-transparent border-none outline-none focus:ring-0 text-foreground font-mono text-sm w-full text-center placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </div>

      {/* Result */}
      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            DOTS Score
          </span>
          <span
            data-testid="points-score"
            className="text-3xl font-bold font-serif italic text-foreground tabular-nums leading-none"
          >
            {score ?? '—'}
          </span>
        </div>

        {tier && (
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
              Tier
            </span>
            <span
              data-testid="points-tier"
              className={cn('text-xs font-mono font-bold uppercase tracking-widest', tier.color)}
            >
              {tier.label}
            </span>
          </div>
        )}

        <p className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed">
          DOTS normalises performance across bodyweight. Tiers assume a 3-lift
          powerlifting total — single-lift inputs will read lower.
        </p>
      </div>
    </div>
  );
}
