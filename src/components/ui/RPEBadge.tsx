import { cn } from '../../lib/utils';

/**
 * Parse an RPE string (or number) into a numeric severity. Ranges like "7-8"
 * use the upper bound so the color reflects the harder cap.
 */
function parseRpe(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const matches = value.match(/(\d+(?:\.\d+)?)/g);
  if (!matches || matches.length === 0) return null;
  return Math.max(...matches.map(Number));
}

function rpeColorClass(value: number): string {
  // Green  — RPE ≤ 7        (easy/moderate, more reps in the tank)
  // Orange — 7 < RPE < 9    (hard, approaching limit)
  // Red    — RPE ≥ 9        (near-max / max effort)
  if (value <= 7) return 'bg-green-500/15  text-green-400  border-green-500/30';
  if (value < 9)  return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
  return 'bg-red-500/15 text-red-400 border-red-500/30';
}

interface RPEBadgeProps {
  value: string | number | undefined;
  className?: string;
}

export function RPEBadge({ value, className }: RPEBadgeProps) {
  const numeric = parseRpe(value);
  if (numeric === null) {
    return (
      <span className={cn('font-mono text-[10px] text-muted-foreground/60', className)}>—</span>
    );
  }
  const display = typeof value === 'string' && /-/.test(value) ? value : String(value);
  return (
    <span
      data-testid="rpe-badge"
      className={cn(
        'inline-flex items-center justify-center px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider border rounded-sm',
        rpeColorClass(numeric),
        className
      )}
    >
      @{display}
    </span>
  );
}