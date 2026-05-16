import { describe, it, expect } from 'vitest';
import {
  sanitizeOnType,
  clampOnCommit,
  parseNumeric,
  kindForColumnId,
  RANGES,
} from '../lib/numericInput';

describe('sanitizeOnType — load (kg, 0–1000, decimals)', () => {
  it('strips letters and other garbage', () => {
    expect(sanitizeOnType('abc100', 'load')).toBe('100');
    expect(sanitizeOnType('100kg', 'load')).toBe('100');
    expect(sanitizeOnType('@#$%^', 'load')).toBe('');
  });

  it('hard-caps at 1000 kg as the user types', () => {
    expect(sanitizeOnType('9999999', 'load')).toBe('1000');
    expect(sanitizeOnType('5000', 'load')).toBe('1000');
    expect(sanitizeOnType('1001', 'load')).toBe('1000');
  });

  it('preserves trailing dot mid-typing so "8." can become "8.5"', () => {
    expect(sanitizeOnType('8.', 'load')).toBe('8.');
    expect(sanitizeOnType('100.', 'load')).toBe('100.');
  });

  it('keeps only the first decimal point', () => {
    expect(sanitizeOnType('1.2.3', 'load')).toBe('1.23');
    expect(sanitizeOnType('1..5', 'load')).toBe('1.5');
  });

  it('translates comma as decimal separator (European keyboards)', () => {
    expect(sanitizeOnType('100,5', 'load')).toBe('100.5');
  });

  it('collapses leading zeros but keeps "0.x"', () => {
    expect(sanitizeOnType('007', 'load')).toBe('7');
    expect(sanitizeOnType('00.5', 'load')).toBe('0.5');
    expect(sanitizeOnType('0', 'load')).toBe('0');
  });

  it('preserves empty input — caller decides what empty means', () => {
    expect(sanitizeOnType('', 'load')).toBe('');
  });

  it('rejects negatives via the minus-sign strip', () => {
    expect(sanitizeOnType('-50', 'load')).toBe('50');
  });
});

describe('sanitizeOnType — rpe (1–10, decimals)', () => {
  it('hard-caps at 10', () => {
    expect(sanitizeOnType('11', 'rpe')).toBe('10');
    expect(sanitizeOnType('99', 'rpe')).toBe('10');
    expect(sanitizeOnType('100', 'rpe')).toBe('10');
  });

  it('allows the typical .5 RPE values', () => {
    expect(sanitizeOnType('8.5', 'rpe')).toBe('8.5');
    expect(sanitizeOnType('9.5', 'rpe')).toBe('9.5');
  });

  it('does NOT enforce min during typing — user may be on the way to 10', () => {
    // While typing "1" then "10", we never want it to bounce to min.
    expect(sanitizeOnType('1', 'rpe')).toBe('1');
    expect(sanitizeOnType('0', 'rpe')).toBe('0'); // commit-time clamp will fix
  });
});

describe('sanitizeOnType — reps (1–100, integers only)', () => {
  it('strips decimal points entirely — reps are integers', () => {
    expect(sanitizeOnType('5.5', 'reps')).toBe('55');
    expect(sanitizeOnType('10.', 'reps')).toBe('10');
  });

  it('hard-caps at 100', () => {
    expect(sanitizeOnType('500', 'reps')).toBe('100');
    expect(sanitizeOnType('9999', 'reps')).toBe('100');
  });
});

describe('sanitizeOnType — sets (1–20, integers only)', () => {
  it('hard-caps at 20', () => {
    expect(sanitizeOnType('21', 'sets')).toBe('20');
    expect(sanitizeOnType('100', 'sets')).toBe('20');
    expect(sanitizeOnType('9999999', 'sets')).toBe('20');
  });

  it('rejects decimals — sets are whole numbers', () => {
    // "3.5" → strip dot → "35" → clamp to 20.
    expect(sanitizeOnType('3.5', 'sets')).toBe('20');
    // "1.0" → strip dot → "10" → in range → "10".
    expect(sanitizeOnType('1.0', 'sets')).toBe('10');
  });
});

describe('clampOnCommit — final boundary clamp', () => {
  it('rounds RPE 0.5 up to floor of 1', () => {
    expect(clampOnCommit('0.5', 'rpe')).toBe('1');
    expect(clampOnCommit('0', 'rpe')).toBe('1');
  });

  it('clamps load to ceiling of 1000', () => {
    expect(clampOnCommit('5000', 'load')).toBe('1000');
  });

  it('drops trailing dots when committing', () => {
    expect(clampOnCommit('8.', 'rpe')).toBe('8');
    expect(clampOnCommit('100.', 'load')).toBe('100');
  });

  it('treats empty as empty (no auto-fill)', () => {
    expect(clampOnCommit('', 'load')).toBe('');
    expect(clampOnCommit('', 'rpe')).toBe('');
    expect(clampOnCommit('.', 'load')).toBe('');
  });

  it('passes through valid in-range values without rounding artifacts', () => {
    expect(clampOnCommit('100', 'load')).toBe('100');
    expect(clampOnCommit('8.5', 'rpe')).toBe('8.5');
    expect(clampOnCommit('5', 'sets')).toBe('5');
  });

  it('rounds load to 1 decimal place (precision)', () => {
    expect(clampOnCommit('100.123', 'load')).toBe('100.1');
    expect(clampOnCommit('100.16', 'load')).toBe('100.2');
  });

  it('clamps bar weight to [5, 30]', () => {
    expect(clampOnCommit('1', 'bar')).toBe('5');
    expect(clampOnCommit('100', 'bar')).toBe('30');
    expect(clampOnCommit('20', 'bar')).toBe('20');
  });

  it('clamps collar weight to [0, 10]', () => {
    expect(clampOnCommit('100', 'collar')).toBe('10');
    expect(clampOnCommit('2.5', 'collar')).toBe('2.5');
    expect(clampOnCommit('0', 'collar')).toBe('0');
  });
});

describe('parseNumeric', () => {
  it('returns a number for valid inputs', () => {
    expect(parseNumeric('100', 'load')).toBe(100);
    expect(parseNumeric('8.5', 'rpe')).toBe(8.5);
  });

  it('returns null for empty / unparseable', () => {
    expect(parseNumeric('', 'load')).toBeNull();
    expect(parseNumeric('.', 'load')).toBeNull();
  });

  it('clamps before returning — never hands back an out-of-range number', () => {
    expect(parseNumeric('99999', 'load')).toBe(1000);
    expect(parseNumeric('100', 'rpe')).toBe(10);
    expect(parseNumeric('0', 'rpe')).toBe(1);
  });
});

describe('kindForColumnId', () => {
  it('maps the legacy plan/actual columns', () => {
    expect(kindForColumnId('sets')).toBe('sets');
    // 'reps', 'expectedRpe', 'actualRpe' moved to free-text — see below
    expect(kindForColumnId('actualLoad')).toBe('load');
  });

  it('returns undefined for free-text columns', () => {
    expect(kindForColumnId('exerciseName')).toBeUndefined();
    expect(kindForColumnId('notes')).toBeUndefined();
    expect(kindForColumnId('weightRange')).toBeUndefined();
    // `reps` is intentionally free text so coaches can type "6-8", "AMRAP",
    // "5+", etc. Numeric extraction for analytics happens in parseReps().
    expect(kindForColumnId('reps')).toBeUndefined();
    // `expectedRpe` and `actualRpe` are also intentionally free text so
    // coaches can prescribe ranges ("7-8") and notation ("@8"), and trainees
    // can log varied effort. parseLoad() extracts the leading number for
    // autoregulation.
    expect(kindForColumnId('expectedRpe')).toBeUndefined();
    expect(kindForColumnId('actualRpe')).toBeUndefined();
    // Custom user-defined column with UUID id
    expect(kindForColumnId('a1b2c3d4-1234-5678-9abc-def012345678')).toBeUndefined();
  });
});

describe('RANGES — domain-correctness sanity check', () => {
  it('powerlifting RPE is the standard 1–10 scale', () => {
    expect(RANGES.rpe.min).toBe(1);
    expect(RANGES.rpe.max).toBe(10);
  });

  it('load max comfortably exceeds the heaviest deadlift on record (~501 kg)', () => {
    expect(RANGES.load.max).toBeGreaterThanOrEqual(1000);
  });

  it('sets max stays at 20 to match WorkoutGridLogger.setCount() ceiling', () => {
    expect(RANGES.sets.max).toBe(20);
  });

  it('bar weight covers typical equipment (15kg women\'s, 20kg standard, 25kg powerlifting)', () => {
    expect(RANGES.bar.min).toBeLessThanOrEqual(15);
    expect(RANGES.bar.max).toBeGreaterThanOrEqual(25);
  });
});
