import { useState } from 'react';
import { Calculator } from 'lucide-react';
import { TechnicalCard } from '../ui';
import { cn } from '../../lib/utils';
import { estimate1RM } from '../../lib/formulas';
import {
  RANGES,
  sanitizeOnType,
  clampOnCommit,
  parseNumeric as parseNumericKind,
  type NumericFieldKind,
} from '../../lib/numericInput';

// Standard percentage tiers a coach refers to when prescribing top sets and
// back-off work. Reps are the conventional ranges associated with each tier
// (Prilepin-style); displayed for context next to the computed load.
const TIERS: Array<{ pct: number; reps: string }> = [
  { pct: 100, reps: '1' },
  { pct: 95,  reps: '2' },
  { pct: 90,  reps: '3-4' },
  { pct: 85,  reps: '5-6' },
  { pct: 80,  reps: '7-8' },
  { pct: 75,  reps: '9-10' },
  { pct: 70,  reps: '11-12' },
  { pct: 65,  reps: '13-15' },
  { pct: 60,  reps: '15+' },
];

// Round table loads to 2.5 kg — the smallest plate pair on a standard rack —
// so the displayed weight is loadable without fractional plates.
const STEP = 2.5;

function blockInvalidNumberKeys(e: React.KeyboardEvent<HTMLInputElement>) {
  if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
}

export function RpeCalculator() {
  const [weight, setWeight] = useState('');
  const [reps, setReps]     = useState('');
  const [rpe, setRpe]       = useState('');

  const w  = parseNumericKind(weight, 'load');
  const r  = parseNumericKind(reps,   'reps');
  const rp = parseNumericKind(rpe,    'rpe');

  const oneRm =
    w !== null && r !== null
      ? estimate1RM(w, r, rp ?? undefined)
      : null;

  return (
    <TechnicalCard className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <Calculator className="w-5 h-5 text-muted-foreground" />
        <h3 className="text-sm font-bold font-mono uppercase tracking-widest">
          1RM Estimator
        </h3>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-3 gap-3">
        {([
          { label: 'Weight (kg)', value: weight, set: setWeight, kind: 'load', testId: 'rpe-calc-weight', placeholder: '0' },
          { label: 'Reps',        value: reps,   set: setReps,   kind: 'reps', testId: 'rpe-calc-reps',   placeholder: '0' },
          { label: 'RPE',         value: rpe,    set: setRpe,    kind: 'rpe',  testId: 'rpe-calc-rpe',    placeholder: '10' },
        ] as Array<{ label: string; value: string; set: (v: string) => void; kind: NumericFieldKind; testId: string; placeholder: string }>).map(
          ({ label, value, set, kind, testId, placeholder }) => {
            const range = RANGES[kind];
            return (
              <label key={label} className="block space-y-1">
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                  {label}
                </span>
                <div className="bg-muted/30 p-3 border border-border">
                  <input
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9.]*"
                    value={value}
                    onChange={(e) => set(sanitizeOnType(e.target.value, kind))}
                    onBlur={(e) => set(clampOnCommit(e.target.value, kind))}
                    onKeyDown={blockInvalidNumberKeys}
                    placeholder={placeholder}
                    aria-valuemin={range.min}
                    aria-valuemax={range.max}
                    data-testid={testId}
                    className={cn(
                      'bg-transparent border-none outline-none focus:ring-0',
                      'text-foreground font-mono text-sm w-full text-center',
                      'placeholder:text-muted-foreground',
                    )}
                  />
                </div>
              </label>
            );
          },
        )}
      </div>

      {/* Estimated 1RM */}
      <div className="border-t border-border pt-4">
        <div className="flex justify-between items-baseline">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Estimated 1RM
          </span>
          <span
            data-testid="rpe-calc-estimate"
            className="text-3xl font-bold font-mono tabular-nums tracking-tight"
          >
            {oneRm !== null ? oneRm : '—'}
            {oneRm !== null && (
              <span className="text-sm text-muted-foreground ml-1">kg</span>
            )}
          </span>
        </div>
        <p className="text-[10px] font-mono text-muted-foreground/70 mt-1">
          RTS / Brzycki hybrid. Blank RPE assumes 10 (true max).
        </p>
      </div>

      {/* Loading table */}
      <div className="border border-border" data-testid="rpe-calc-table">
        <div className="grid grid-cols-[1fr_1fr_1fr] text-[10px] font-mono text-muted-foreground uppercase tracking-widest border-b border-border bg-muted/20">
          <div className="p-2">Pct</div>
          <div className="p-2 text-center">Load</div>
          <div className="p-2 text-right">Reps</div>
        </div>
        {TIERS.map((tier) => {
          const load =
            oneRm !== null
              ? Math.round(((oneRm * tier.pct) / 100) / STEP) * STEP
              : null;
          return (
            <div
              key={tier.pct}
              className="grid grid-cols-[1fr_1fr_1fr] text-xs font-mono border-b border-border/50 last:border-b-0"
            >
              <div className="p-2 font-bold">{tier.pct}%</div>
              <div className="p-2 text-center tabular-nums">
                {load !== null ? `${load} kg` : '—'}
              </div>
              <div className="p-2 text-right text-muted-foreground">
                {tier.reps}
              </div>
            </div>
          );
        })}
      </div>
    </TechnicalCard>
  );
}
