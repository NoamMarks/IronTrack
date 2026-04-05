/** Standard powerlifting plate weights in kg, descending */
const PLATE_WEIGHTS = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

/** IPF color codes for each plate weight */
const PLATE_COLORS: Record<number, string> = {
  25:   '#ef4444', // red
  20:   '#3b82f6', // blue
  15:   '#facc15', // yellow
  10:   '#22c55e', // green
  5:    '#f8fafc', // white
  2.5:  '#1e1e1e', // black
  1.25: '#a3a3a3', // silver/grey
};

export interface PlateResult {
  plates: number[];
  totalWeight: number;
  remainder: number;
}

/**
 * Calculate which plates to load on ONE side of the barbell.
 * Subtracts bar + collars, divides by 2, then greedily fills with largest plates.
 */
export function calculatePlates(
  targetWeight: number,
  barWeight = 20,
  collarWeight = 2.5,
): PlateResult {
  const totalFixedWeight = barWeight + collarWeight * 2;

  if (targetWeight <= totalFixedWeight) {
    return { plates: [], totalWeight: totalFixedWeight, remainder: 0 };
  }

  let remaining = (targetWeight - totalFixedWeight) / 2;
  const plates: number[] = [];

  for (const plate of PLATE_WEIGHTS) {
    while (remaining >= plate - 0.001) {
      plates.push(plate);
      remaining -= plate;
    }
  }

  const loadedPerSide = plates.reduce((s, p) => s + p, 0);
  const totalWeight = totalFixedWeight + loadedPerSide * 2;
  const remainder = Math.round((targetWeight - totalWeight) * 100) / 100;

  return { plates, totalWeight, remainder };
}

export function getPlateColor(weight: number): string {
  return PLATE_COLORS[weight] ?? '#6b7280';
}

export function getPlateWidth(weight: number): number {
  if (weight >= 25) return 48;
  if (weight >= 15) return 44;
  if (weight >= 10) return 40;
  if (weight >= 5) return 32;
  return 24;
}
