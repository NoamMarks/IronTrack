/**
 * Strength-calculator math.
 *
 * NOTE: `lib/analytics.ts` also exports an `estimate1RM(weight, reps)` using
 * the Epley formula (no RPE input). The two are intentionally separate:
 *  - `analytics.ts` aggregates historical sessions, where RPE wasn't always
 *     logged, so Epley (single-input) is the safer pick for legacy rows.
 *  - This module powers the calculator UI where the trainee provides RPE
 *     explicitly and expects the more nuanced RTS/Brzycki hybrid number.
 * Imports are unambiguous because they reference the file. Keep the formulas
 * aligned (or pick one) before surfacing both numbers in the same view.
 */

// ─── 1RM estimation ──────────────────────────────────────────────────────────

/**
 * RTS/Brzycki hybrid e1RM.
 *
 * Brzycki:        1RM = weight / (1.0278 − 0.0278 × reps)        [reps to failure]
 * RTS adjustment: effectiveReps = reps + RIR, where RIR = 10 − RPE.
 *                 Treats RPE 8 with 5 reps as equivalent to 7 reps to failure.
 *
 * When `rpe` is omitted (or out of range), we assume RPE 10 — i.e. the set
 * was a true max — and the formula collapses to plain Brzycki.
 *
 * Returns null when the inputs are invalid or the formula's denominator
 * approaches zero (effectiveReps ≥ 36, beyond which Brzycki diverges and the
 * estimate is unreliable). Confidence drops past ~12 effective reps even
 * within the valid range; consumers should display a caveat for high reps.
 */
export function estimate1RM(weight: number, reps: number, rpe?: number): number | null {
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return null;
  if (weight <= 0 || reps <= 0) return null;

  const safeRpe = Number.isFinite(rpe) && (rpe as number) >= 1 && (rpe as number) <= 10
    ? (rpe as number)
    : 10;
  const rir = 10 - safeRpe;
  const effectiveReps = reps + rir;

  // Brzycki denominator hits zero around effectiveReps ≈ 36.97. Cap below
  // that — anything past ~25 reps is already beyond the formula's calibration.
  if (effectiveReps >= 36) return null;
  const denom = 1.0278 - 0.0278 * effectiveReps;
  if (denom <= 0) return null;

  const oneRm = weight / denom;
  if (!Number.isFinite(oneRm) || oneRm <= 0) return null;
  return Math.round(oneRm * 10) / 10;
}

// ─── Relative-strength scoring ───────────────────────────────────────────────

export type Gender = 'male' | 'female';
export type PointsFormula = 'wilks' | 'ipf-gl';

// Wilks 2020 update coefficients (Robert Wilks, 2020). The score is the
// athlete's total times 600 divided by a 5th-degree polynomial of their
// bodyweight in kg. Coefficients sourced from the 2020 publication.
const WILKS_2020_MEN = [
   47.4617885411949,
    8.47206137941125,
    0.073694103462609,
   -0.00139583381094385,
    7.07665973070743e-6,
   -1.20804336482315e-8,
] as const;

const WILKS_2020_WOMEN = [
 -125.425539779509,
   13.7121941940668,
   -0.0330725063103405,
   -0.00105040005065831,
    9.38773881462799e-6,
   -2.3334613884954e-8,
] as const;

// IPF GL Points (GoodLift, 2020 — replaced the older IPF Points). Returns
// score = total × 100 / (A − B·exp(−C·BW)). These are the *Classic* (raw, no
// equipment) Open coefficients; equipped or sub-junior categories use
// different constants and are out of scope for the calculator.
const IPF_GL_CLASSIC_MEN   = { A: 1199.72839, B: 1025.18162, C: 0.00921    } as const;
const IPF_GL_CLASSIC_WOMEN = { A:  610.32796, B: 1045.59282, C: 0.03048    } as const;

/**
 * Wilks 2020 or IPF GL Classic score for a competition total.
 *
 * `bodyweight` and `total` are kg. Returns null on invalid inputs (zero or
 * negative weights, NaN) or when the formula's denominator is non-positive
 * (only happens at impossible bodyweights — guarded for safety, not realism).
 *
 * Result is rounded to two decimals — the standard precision both federations
 * publish on result sheets.
 */
export function calculatePoints(
  bodyweight: number,
  total: number,
  gender: Gender,
  formula: PointsFormula,
): number | null {
  if (!Number.isFinite(bodyweight) || bodyweight <= 0) return null;
  if (!Number.isFinite(total) || total <= 0) return null;

  if (formula === 'wilks') {
    const c = gender === 'male' ? WILKS_2020_MEN : WILKS_2020_WOMEN;
    const bw = bodyweight;
    const denom = c[0]
      + c[1] * bw
      + c[2] * bw * bw
      + c[3] * bw * bw * bw
      + c[4] * bw * bw * bw * bw
      + c[5] * bw * bw * bw * bw * bw;
    if (!Number.isFinite(denom) || denom <= 0) return null;
    return Math.round((total * 600 / denom) * 100) / 100;
  }

  if (formula === 'ipf-gl') {
    const c = gender === 'male' ? IPF_GL_CLASSIC_MEN : IPF_GL_CLASSIC_WOMEN;
    const denom = c.A - c.B * Math.exp(-c.C * bodyweight);
    if (!Number.isFinite(denom) || denom <= 0) return null;
    return Math.round((total * 100 / denom) * 100) / 100;
  }

  return null;
}
