import { useState } from 'react';
import { Trophy } from 'lucide-react';
import { TechnicalCard } from '../ui';
import { cn } from '../../lib/utils';
import { calculatePoints, type Gender, type PointsFormula } from '../../lib/formulas';
import {
  RANGES,
  sanitizeOnType,
  clampOnCommit,
  parseNumeric as parseNumericKind,
} from '../../lib/numericInput';

function blockInvalidNumberKeys(e: React.KeyboardEvent<HTMLInputElement>) {
  if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
}

export function PointsCalculator() {
  const [bodyweight, setBodyweight] = useState('');
  const [total, setTotal]           = useState('');
  const [gender, setGender]         = useState<Gender>('male');
  const [formula, setFormula]       = useState<PointsFormula>('wilks');

  // Both inputs share the 'load' NumericFieldKind (0–1000 kg, 1 decimal). Real
  // bodyweights and totals fit comfortably; the rare super-heavyweight 1100+
  // kg total falls outside the calculator's scope.
  const bw    = parseNumericKind(bodyweight, 'load');
  const tot   = parseNumericKind(total, 'load');
  const range = RANGES.load;

  const score =
    bw !== null && tot !== null ? calculatePoints(bw, tot, gender, formula) : null;

  // The opposite-formula score, shown as a small secondary readout so the
  // user can compare without flipping the toggle.
  const otherFormula: PointsFormula = formula === 'wilks' ? 'ipf-gl' : 'wilks';
  const otherScore =
    bw !== null && tot !== null
      ? calculatePoints(bw, tot, gender, otherFormula)
      : null;

  return (
    <TechnicalCard className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <Trophy className="w-5 h-5 text-muted-foreground" />
        <h3 className="text-sm font-bold font-mono uppercase tracking-widest">
          Relative Strength
        </h3>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 gap-3">
        {([
          { label: 'Bodyweight (kg)', value: bodyweight, set: setBodyweight, testId: 'points-calc-bw',    placeholder: '75'  },
          { label: 'Total (kg)',       value: total,      set: setTotal,      testId: 'points-calc-total', placeholder: '500' },
        ] as Array<{ label: string; value: string; set: (v: string) => void; testId: string; placeholder: string }>).map(
          ({ label, value, set, testId, placeholder }) => (
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
                  onChange={(e) => set(sanitizeOnType(e.target.value, 'load'))}
                  onBlur={(e) => set(clampOnCommit(e.target.value, 'load'))}
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
          ),
        )}
      </div>

      {/* Toggles */}
      <div className="grid grid-cols-2 gap-3">
        <Toggle<Gender>
          label="Gender"
          value={gender}
          onChange={setGender}
          options={[
            { value: 'male',   label: 'M' },
            { value: 'female', label: 'F' },
          ]}
          testIdPrefix="points-calc-gender"
        />
        <Toggle<PointsFormula>
          label="Formula"
          value={formula}
          onChange={setFormula}
          options={[
            { value: 'wilks',  label: 'Wilks' },
            { value: 'ipf-gl', label: 'IPF GL' },
          ]}
          testIdPrefix="points-calc-formula"
        />
      </div>

      {/* Score readout */}
      <div className="border-t border-border pt-4 space-y-1">
        <div className="flex justify-between items-baseline">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            {formula === 'wilks' ? 'Wilks 2020' : 'IPF GL'}
          </span>
          <span
            data-testid="points-calc-score"
            className="text-3xl font-bold font-mono tabular-nums tracking-tight"
          >
            {score !== null ? score.toFixed(2) : '—'}
          </span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">
            {otherFormula === 'wilks' ? 'Wilks 2020' : 'IPF GL'}
          </span>
          <span
            data-testid="points-calc-score-alt"
            className="text-sm font-mono tabular-nums text-muted-foreground"
          >
            {otherScore !== null ? otherScore.toFixed(2) : '—'}
          </span>
        </div>
      </div>
    </TechnicalCard>
  );
}

// ─── Brutalist segmented toggle ──────────────────────────────────────────────

interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

interface ToggleProps<T extends string> {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: ToggleOption<T>[];
  testIdPrefix: string;
}

function Toggle<T extends string>({
  label,
  value,
  onChange,
  options,
  testIdPrefix,
}: ToggleProps<T>) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
        {label}
      </span>
      <div className="grid grid-cols-2 border border-border">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              data-testid={`${testIdPrefix}-${opt.value}`}
              className={cn(
                'px-3 py-2 text-xs font-bold uppercase tracking-widest font-mono transition-colors',
                active
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
