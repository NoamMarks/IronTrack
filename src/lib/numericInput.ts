/**
 * Numeric input sanitization for the lifting domain.
 *
 * Every numeric field in IronTrack lives in one of six buckets — load (kg),
 * rpe (1-10), reps (1-100), sets (1-20), bar weight (5-30 kg), collar weight
 * (0-10 kg). Each bucket has fixed sane bounds drawn from competition reality
 * (heaviest deadlift on record is ~501 kg → 1000 kg ceiling is a comfortable
 * 2× headroom; RPE is the standard 1-10 Tuchscherer scale, etc.).
 *
 * Two-phase model:
 *   1. **`sanitizeOnType`** — keystroke-time. Strips letters and stray
 *      punctuation, enforces "at most one decimal point" / "no decimals at
 *      all" depending on the field, and hard-caps the parsed value at `max`.
 *      It deliberately does NOT enforce `min` because the user is mid-typing
 *      ("1" on the way to "10") and yanking the value to `min` mid-stroke
 *      would feel awful.
 *   2. **`clampOnCommit`** — blur / submit time. Applies the full [min, max]
 *      clamp and rounds to the field's allowed precision. Empty stays empty
 *      (an unfilled set is a valid state — the trainee may have skipped).
 *
 * UX rules baked into the sanitizer:
 *   - Empty string is preserved — never substituted with `min`.
 *   - Trailing `.` is kept while typing ("8." on the way to "8.5") so the
 *     dot doesn't get eaten under the user.
 *   - Leading zeros are normalized: "007" → "7", but "0.5" stays "0.5".
 */

export type NumericFieldKind = 'load' | 'rpe' | 'reps' | 'sets' | 'bar' | 'collar';

export interface NumericRange {
  /** Lower bound (inclusive). Used by `clampOnCommit`. */
  min: number;
  /** Upper bound (inclusive). Enforced both during typing and on commit. */
  max: number;
  /** When false, the input is integers-only (no `.` allowed at any point). */
  decimal: boolean;
  /** Decimal places retained after `clampOnCommit`. Ignored when `decimal: false`. */
  precision: number;
}

/**
 * Powerlifting-domain ranges. These are deliberately wider than the typical
 * trainee will ever need — the goal is to reject obvious garbage (10000 kg,
 * RPE 99) without second-guessing legitimate edge cases (a 220 kg squat, a
 * 60-rep AMRAP).
 */
export const RANGES: Record<NumericFieldKind, NumericRange> = {
  load:   { min: 0, max: 1000, decimal: true,  precision: 1 },
  rpe:    { min: 1, max: 10,   decimal: true,  precision: 1 },
  reps:   { min: 1, max: 100,  decimal: false, precision: 0 },
  sets:   { min: 1, max: 20,   decimal: false, precision: 0 },
  bar:    { min: 5, max: 30,   decimal: true,  precision: 1 },
  collar: { min: 0, max: 10,   decimal: true,  precision: 1 },
};

/**
 * Map a coach-program-editor column id to a NumericFieldKind, or undefined
 * if the column is free-text (exercise name, notes, weight range like
 * "70-80kg" which isn't a single numeric value).
 *
 * Custom user-defined columns (UUID ids) fall through to undefined and are
 * treated as free text — sanitizing them as numeric would corrupt legit
 * non-numeric data.
 */
export function kindForColumnId(colId: string): NumericFieldKind | undefined {
  if (colId === 'sets')        return 'sets';
  if (colId === 'reps')        return 'reps';
  if (colId === 'expectedRpe') return 'rpe';
  if (colId === 'actualRpe')   return 'rpe';
  if (colId === 'actualLoad')  return 'load';
  return undefined;
}

/**
 * Strip everything except digits and (when `decimal`) at most one dot. Keeps
 * trailing dots, leading-zero collapse, and partial-typing UX intact.
 *
 * Returns the cleaned string. Does NOT clamp — that's the caller's job via
 * `sanitizeOnType` (which adds the max clamp).
 */
function stripToNumeric(raw: string, decimal: boolean): string {
  if (raw === '') return '';
  // Accept comma as decimal separator (European keyboards) and translate
  // into a dot before any further work.
  let s = raw.replace(/,/g, '.');
  // Drop everything that isn't a digit or dot.
  s = s.replace(decimal ? /[^0-9.]/g : /[^0-9]/g, '');
  if (decimal) {
    // Keep only the first dot. "1.2.3" → "1.23".
    const firstDot = s.indexOf('.');
    if (firstDot !== -1) {
      s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
    }
  }
  // Collapse leading zeros: "007" → "7", "00.5" → "0.5", "0" stays "0".
  if (s.length > 1 && s.startsWith('0') && s[1] !== '.') {
    s = s.replace(/^0+/, '');
    if (s === '' || s.startsWith('.')) s = `0${s}`;
  }
  return s;
}

/**
 * Keystroke-time sanitizer. Pass the raw input value; get back a string safe
 * to feed into both the controlled input AND any downstream consumer (max is
 * already enforced).
 *
 * The result may be:
 *   - `""` (user cleared the field; valid state)
 *   - `"."` or `"0."` (mid-typing decimal — preserved so the input doesn't
 *     fight the user)
 *   - a numeric string in `[0, max]` rounded to the field's precision
 */
export function sanitizeOnType(raw: string, kind: NumericFieldKind): string {
  const range = RANGES[kind];
  const stripped = stripToNumeric(raw, range.decimal);
  if (stripped === '' || stripped === '.') return stripped;
  // "1." or "0." — partial decimal, leave as-is so the user can keep typing.
  if (range.decimal && stripped.endsWith('.')) {
    const n = Number(stripped.slice(0, -1));
    if (Number.isFinite(n) && n > range.max) {
      // "9999." → cap to max with a trailing dot makes no sense. Drop the dot.
      return formatToPrecision(range.max, range.precision);
    }
    return stripped;
  }
  const n = Number(stripped);
  if (!Number.isFinite(n)) return '';
  if (n > range.max) return formatToPrecision(range.max, range.precision);
  return stripped;
}

/**
 * Commit-time clamp. Apply this on blur, before persisting, or before
 * passing to a calculation that assumes a valid number. Returns:
 *   - `""` when input is empty (caller decides what to do with that)
 *   - the original string when it round-trips through clamp + precision
 *     unchanged (avoids the input visibly jumping for already-valid values)
 *   - the clamped numeric string otherwise
 */
export function clampOnCommit(raw: string, kind: NumericFieldKind): string {
  if (raw === '' || raw === '.') return '';
  const range = RANGES[kind];
  const stripped = stripToNumeric(raw, range.decimal);
  if (stripped === '' || stripped === '.') return '';
  const n = Number(stripped);
  if (!Number.isFinite(n)) return '';
  const clamped = Math.min(Math.max(n, range.min), range.max);
  return formatToPrecision(clamped, range.precision);
}

/**
 * Parse a sanitized string into a number, or null when empty/invalid.
 * Use this when you need a real number for arithmetic (analytics, plate
 * calculator) rather than for display.
 */
export function parseNumeric(raw: string, kind: NumericFieldKind): number | null {
  const cleaned = clampOnCommit(raw, kind);
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatToPrecision(n: number, precision: number): string {
  if (precision <= 0) return String(Math.round(n));
  // Round to precision then strip trailing zeros so "10.0" reads as "10".
  const factor = 10 ** precision;
  const rounded = Math.round(n * factor) / factor;
  return String(rounded);
}
