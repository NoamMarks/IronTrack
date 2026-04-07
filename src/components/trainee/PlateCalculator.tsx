import { useState, useEffect } from 'react';
import { Modal } from '../ui';
import { cn } from '../../lib/utils';
import { calculatePlates, getPlateColor, getPlateWidth } from '../../lib/plateCalculator';

interface PlateCalculatorProps {
  isOpen: boolean;
  onClose: () => void;
  initialWeight?: string;
  /** If provided, renders an "Apply Weight" button that emits the current target. */
  onApply?: (weight: string) => void;
}

/**
 * Strict numeric parser — returns `undefined` if the string cannot be interpreted
 * as a finite non-negative number. Crucially, `"0"` parses to `0`, not `undefined`,
 * so a user can explicitly zero out the bar or collars.
 */
function parseNumeric(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/** Block non-numeric characters (`e`, `+`, `-`, letters) in number inputs. */
function blockInvalidNumberKeys(e: React.KeyboardEvent<HTMLInputElement>) {
  if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
}

export function PlateCalculator({ isOpen, onClose, initialWeight = '', onApply }: PlateCalculatorProps) {
  const [targetInput, setTargetInput] = useState(initialWeight);
  const [barWeight, setBarWeight] = useState('20');
  const [collarWeight, setCollarWeight] = useState('2.5');

  // Re-sync target whenever the modal (re)opens with a new initialWeight —
  // e.g. opening the calculator for a different set in WorkoutGridLogger.
  useEffect(() => {
    if (isOpen) setTargetInput(initialWeight);
  }, [isOpen, initialWeight]);

  const target = parseNumeric(targetInput) ?? 0;
  const bar = parseNumeric(barWeight) ?? 20;
  // Default to 2.5 only when the field is *empty* — an explicit 0 means no collars.
  const collar = parseNumeric(collarWeight) ?? 2.5;

  const result = calculatePlates(target, bar, collar);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Plate Calculator">
      <div className="space-y-6">
        {/* Inputs */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Target (kg)', value: targetInput, set: setTargetInput, testId: 'plate-target' },
            { label: 'Bar (kg)', value: barWeight, set: setBarWeight, testId: 'plate-bar' },
            { label: 'Collars (kg)', value: collarWeight, set: setCollarWeight, testId: 'plate-collar' },
          ].map(({ label, value, set, testId }) => (
            <div key={label} className="space-y-1">
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                {label}
              </label>
              <div className="bg-muted/30 p-3 border border-border">
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  onKeyDown={blockInvalidNumberKeys}
                  placeholder="0"
                  data-testid={testId}
                  className={cn(
                    'bg-transparent border-none outline-none focus:ring-0 text-foreground font-mono text-sm w-full text-center placeholder:text-muted-foreground',
                    '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                  )}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Barbell visualization — overflow-x-auto prevents huge weights from
            bleeding outside the modal padding */}
        <div
          className="bg-muted/20 border border-border p-6 rounded-sm overflow-x-auto no-scrollbar"
          data-testid="barbell-visual"
        >
          <div className="flex items-center justify-center gap-0.5 min-w-max">
            {/* Left plates (reversed for visual) */}
            <div className="flex items-center gap-0.5 flex-row-reverse">
              {result.plates.map((plate, i) => (
                <div
                  key={`l-${i}`}
                  data-testid={`loaded-plate-${plate}`}
                  className={cn(
                    'rounded-sm flex items-center justify-center text-[9px] font-bold shrink-0',
                    plate === 2.5 && 'border border-zinc-500'
                  )}
                  style={{
                    backgroundColor: getPlateColor(plate),
                    width: `${Math.max(16, getPlateWidth(plate) / 2.5)}px`,
                    height: `${getPlateWidth(plate)}px`,
                    color: plate === 5 ? '#000' : '#fff',
                  }}
                >
                  {plate}
                </div>
              ))}
            </div>

            {/* Collar */}
            <div className="w-2 h-8 bg-zinc-500 rounded-sm" />

            {/* Bar */}
            <div className="h-3 bg-zinc-400 rounded-full" style={{ width: '80px' }} />

            {/* Collar */}
            <div className="w-2 h-8 bg-zinc-500 rounded-sm" />

            {/* Right plates */}
            <div className="flex items-center gap-0.5">
              {result.plates.map((plate, i) => (
                <div
                  key={`r-${i}`}
                  className={cn(
                    'rounded-sm flex items-center justify-center text-[9px] font-bold shrink-0',
                    plate === 2.5 && 'border border-zinc-500'
                  )}
                  style={{
                    backgroundColor: getPlateColor(plate),
                    width: `${Math.max(16, getPlateWidth(plate) / 2.5)}px`,
                    height: `${getPlateWidth(plate)}px`,
                    color: plate === 5 ? '#000' : '#fff',
                  }}
                >
                  {plate}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="flex justify-between text-xs font-mono text-muted-foreground border-t border-border pt-4">
          <span>Per side: {result.plates.length > 0 ? result.plates.join(' + ') : 'empty'}</span>
          <span>Loaded: {result.totalWeight}kg</span>
        </div>

        {result.remainder > 0 && (
          <p className="text-[10px] font-mono text-amber-500">
            Cannot exactly load {target}kg — closest is {result.totalWeight}kg ({result.remainder}kg off)
          </p>
        )}

        {/* Apply action — only shown when the modal was opened from a logger row */}
        {onApply && (
          <button
            type="button"
            onClick={() => onApply(targetInput)}
            data-testid="plate-apply-btn"
            disabled={parseNumeric(targetInput) === undefined}
            className={cn(
              'w-full py-3 text-xs font-bold uppercase tracking-widest transition-all',
              'bg-foreground text-background hover:opacity-90',
              'disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            Apply Weight
          </button>
        )}
      </div>
    </Modal>
  );
}
