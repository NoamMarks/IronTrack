import { useState } from 'react';
import { cn } from '../../lib/utils';
import {
  sanitizeOnType,
  clampOnCommit,
  parseNumeric as parseNumericKind,
} from '../../lib/numericInput';

type Sex = 'M' | 'F';

/**
 * DOTS coefficient — the modern (2020+) successor to Wilks for powerlifting
 * across-bodyweight comparisons. Polynomial in bodyweight, scaled to put a
 * "world-class" total around 500.
 *
 *   DOTS = 500 / (a·BW^4 + b·BW^3 + c·BW^2 + d·BW + e)
 *   score = total · DOTS
 *
 * Coefficients & bodyweight clamps per the openpowerlifting DOTS spec.
 */
const DOTS_COEFS: Record<Sex, { coefs: [number, number, number, number, number]; bwMin: number; bwMax: number }> = {
  M: {
    coefs: [-0.000001093, 0.0007391293, -0.1918759221, 24.0900756, -307.75076],
    bwMin: 40,
    bwMax: 210,
  },
  F: {
    coefs: [-0.0000010706, 0.00079484, -0.16711582, 13.6175032, -57.96288],
    bwMin: 40,
    bwMax: 150,
  },
};

function dotsScore(sex: Sex, bw: number, total: number): number | null {
  if (!Number.isFinite(bw) || bw <= 0) return null;
  if (!Number.isFinite(total) || total <= 0) return null;
  const { coefs, bwMin, bwMax } = DOTS_COEFS[sex];
  const clampedBW = Math.min(Math.max(bw, bwMin), bwMax);
  const [a, b, c, d, e] = coefs;
  const denom =
    a * clampedBW ** 4 +
    b * clampedBW ** 3 +
    c * clampedBW ** 2 +
    d * clampedBW +
    e;
  if (denom <= 0) return null;
  const coef = 500 / denom;
  return Math.round(total * coef * 10) / 10;
}

/**
 * Coarse tier labels for a 3-lift powerlifting total. Single-lift inputs
 * will always read lower than these thresholds suggest — communicated in
 * the footnote so the user isn't surprised.
 */
function tierFor(score: number | null): { label: string; color: string } | null {
  if (score === null) return null;
  if (score < 200) return { label: 'Developing',   color: 'text-zinc-400' };
  if (score < 300) return { label: 'Intermediate', color: 'text-sky-400' };
  if (score < 400) return { label: 'Advanced',     color: 'text-emerald-400' };
  if (score < 500) return { label: 'Elite',        color: 'text-amber-400' };
  return            { label: 'World-Class',        color: 'text-red-400' };
}

function blockInvalidNumberKeys(e: React.KeyboardEvent<HTMLInputElement>) {
  if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
}

export function PointsCalculator() {
  const [sex, setSex] = useState<Sex>('M');
  const [bodyweightInput, setBodyweightInput] = useState('80');
  const [totalInput, setTotalInput] = useState('500');

  const bw = parseNumericKind(bodyweightInput, 'load') ?? 0;
  const total = parseNumericKind(totalInput, 'load') ?? 0;
  const score = dotsScore(sex, bw, total);
  const tier = tierFor(score);

  return (
    <div className="space-y-5">
      {/* Sex toggle */}
      <div className="space-y-1">
        <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
          Class
        </label>
        <div className="grid grid-cols-2 gap-px bg-border">
          {(['M', 'F'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSex(s)}
              data-testid={`points-sex-${s}`}
              aria-pressed={sex === s}
              className={cn(
                'py-2 text-[11px] font-mono uppercase tracking-widest transition-colors',
                sex === s
                  ? 'bg-foreground text-background'
                  : 'bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {s === 'M' ? 'Men' : 'Women'}
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
