/**
 * Thin wrapper over `navigator.vibrate`. No-op when the API is unavailable
 * (desktop browsers, iOS Safari) so callers never need a safety check.
 */

function supported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function buzz(pattern: number | number[]): void {
  if (!supported()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignore — some browsers throw on rapid bursts */
  }
}

/** Short tick — used when a single set/cell is logged. */
export const hapticTick = () => buzz(20);

/** Medium pulse — used on Save Session. */
export const hapticSuccess = () => buzz([50]);

/** Strong triple pulse — used when the rest timer hits zero. */
export const hapticAlarm = () => buzz([120, 60, 120, 60, 200]);