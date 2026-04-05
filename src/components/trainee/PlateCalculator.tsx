import { useState } from 'react';
import { Modal, TechnicalInput } from '../ui';
import { calculatePlates, getPlateColor, getPlateWidth } from '../../lib/plateCalculator';

interface PlateCalculatorProps {
  isOpen: boolean;
  onClose: () => void;
  initialWeight?: string;
}

export function PlateCalculator({ isOpen, onClose, initialWeight = '' }: PlateCalculatorProps) {
  const [targetInput, setTargetInput] = useState(initialWeight);
  const [barWeight, setBarWeight] = useState('20');
  const [collarWeight, setCollarWeight] = useState('2.5');

  const target = parseFloat(targetInput) || 0;
  const bar = parseFloat(barWeight) || 20;
  const collar = parseFloat(collarWeight) || 2.5;

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
                <TechnicalInput value={value} onChange={set} placeholder="0" data-testid={testId} />
              </div>
            </div>
          ))}
        </div>

        {/* Barbell visualization */}
        <div className="bg-muted/20 border border-border p-6 rounded-sm" data-testid="barbell-visual">
          <div className="flex items-center justify-center gap-0.5">
            {/* Left plates (reversed for visual) */}
            <div className="flex items-center gap-0.5 flex-row-reverse">
              {result.plates.map((plate, i) => (
                <div
                  key={`l-${i}`}
                  data-testid={`loaded-plate-${plate}`}
                  className="rounded-sm flex items-center justify-center text-[9px] font-bold"
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
                  className="rounded-sm flex items-center justify-center text-[9px] font-bold"
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
      </div>
    </Modal>
  );
}
