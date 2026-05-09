import { useState, useEffect } from 'react';
import { Modal, Button } from '../ui';
import { cn } from '../../lib/utils';
import { calculatePlates, getPlateColor, getPlateWidth } from '../../lib/plateCalculator';
import {
  RANGES,
  sanitizeOnType,
  clampOnCommit,
  parseNumeric as parseNumericKind,
  type NumericFieldKind,
} from '../../lib/numericInput';

interface PlateCalculatorProps {
  /** Render without the Modal chrome — for embedding in a page (e.g. the
   *  landing-page Technical Playground). When true, isOpen/onClose are
   *  ignored and the component shows its content unconditionally. */
  isInline?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  initialWeight?: string;
  /** If provided, renders an "Apply Weight" button that emits the current target. */
  onApply?: (weight: string) => void;
}

/** Block non-numeric characters (`e`, `+`, `-`, letters) in number inputs. */
function blockInvalidNumberKeys(e: React.KeyboardEvent<HTMLInputElement>) {
  if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
}

export function PlateCalculator({
  isInline = false,
  isOpen = false,
  onClose,
  initialWeight = '',
  onApply,
}: PlateCalculatorProps) {
  const [targetInput, setTargetInput] = useState(initialWeight);
  const [barWeight, setBarWeight] = useState('20');
  const [collarWeight, setCollarWeight] = useState('2.5');

  // Re-sync target whenever the modal (re)opens with a new initialWeight —
  // e.g. opening the calculator for a different set in WorkoutGridLogger.
  // In inline mode there is no open/close cycle, so we sync any time
  // initialWeight changes externally.
  useEffect(() => {
    if (isInline || isOpen) setTargetInput(initialWeight);
  }, [isInline, isOpen, initialWeight]);

  // Each field clamps independently — see RANGES in lib/numericInput.ts.
  // Defaults match competition standard equipment so a fresh modal renders
  // a usable layout immediately.
  const target = parseNumericKind(targetInput, 'load') ?? 0;
  const bar = parseNumericKind(barWeight, 'bar') ?? 20;
  // Empty collar field means "no collars" rather than the default — but we
  // still treat the unparseable case as default 2.5 to keep visual layout sane.
  const collar = collarWeight.trim() === '' ? 2.5 : (parseNumericKind(collarWeight, 'collar') ?? 0);

  const result = calculatePlates(target, bar, collar);

  const body = (
    <div className="space-y-6">
        {/* Inputs — each one bound to a NumericFieldKind so they share the
            same overflow / decimals / clamp rules as the rest of the app. */}
        <div className="grid grid-cols-3 gap-3">
          {([
            { label: 'Target (kg)',  value: targetInput, set: setTargetInput, testId: 'plate-target', kind: 'load'   },
            { label: 'Bar (kg)',     value: barWeight,    set: setBarWeight,    testId: 'plate-bar',    kind: 'bar'    },
            { label: 'Collars (kg)', value: collarWeight, set: setCollarWeight, testId: 'plate-collar', kind: 'collar' },
          ] as Array<{ label: string; value: string; set: (v: string) => void; testId: string; kind: NumericFieldKind }>).map(({ label, value, set, testId, kind }) => {
            const range = RANGES[kind];
            return (
              <div key={label} className="space-y-1">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                  {label}
                </label>
                <div className="bg-surface p-3 border-b border-border">
                  <input
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9.]*"
                    value={value}
                    onChange={(e) => set(sanitizeOnType(e.target.value, kind))}
                    onBlur={(e) => set(clampOnCommit(e.target.value, kind))}
                    onKeyDown={blockInvalidNumberKeys}
                    placeholder="0"
                    aria-valuemin={range.min}
                    aria-valuemax={range.max}
                    data-testid={testId}
                    className={cn(
                      'bg-transparent border-none outline-none focus:ring-0 text-foreground font-mono text-sm w-full text-center placeholder:text-muted-foreground'
                    )}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Barbell visualization — overflow-x-auto prevents huge weights from
            bleeding outside the modal padding */}
        <div
          className="bg-surface border border-border/50 p-6 rounded-sm overflow-x-auto no-scrollbar"
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
          <p className="text-[10px] font-mono text-warning">
            Cannot exactly load {target}kg — closest is {result.totalWeight}kg ({result.remainder}kg off)
          </p>
        )}

        {/* Apply action — only shown when the modal was opened from a logger row.
            Emits the COMMIT-clamped value so a downstream input never receives
            a partial-typing string like "8." or anything > 1000 kg. */}
        {onApply && (
          <Button
            variant="primary"
            className="w-full py-3"
            onClick={() => onApply(clampOnCommit(targetInput, 'load'))}
            data-testid="plate-apply-btn"
            disabled={parseNumericKind(targetInput, 'load') === null}
          >
            Apply to Set
          </Button>
        )}
      </div>
  );

  if (isInline) return body;

  return (
    <Modal isOpen={isOpen} onClose={onClose ?? (() => {})} title="Plate Calculator">
      {body}
    </Modal>
  );
}
