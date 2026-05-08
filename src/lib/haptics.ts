/**
 * Haptic feedback shim. On web we use `navigator.vibrate`; on Capacitor
 * (Android/iOS) we route through `@capacitor/haptics` so iOS — which doesn't
 * support `navigator.vibrate` — gets real Taptic Engine pulses.
 *
 * Calls are best-effort: if the platform refuses (no vibrator hardware,
 * permission revoked, browser restriction), we silently no-op so callers
 * never need a try/catch on the gym floor.
 */
import { isNative } from './platform';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

function webBuzz(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some browsers throw on rapid bursts — ignore */
  }
}

/** Short tick — used when a single set/cell is logged. */
export const hapticTick = (): void => {
  if (isNative()) {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    return;
  }
  webBuzz(20);
};

/** Medium pulse — used on Save Session / Finish Workout. */
export const hapticSuccess = (): void => {
  if (isNative()) {
    void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    return;
  }
  webBuzz([50]);
};

/** Strong triple pulse — used when the rest timer hits zero. */
export const hapticAlarm = (): void => {
  if (isNative()) {
    void Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
    return;
  }
  webBuzz([120, 60, 120, 60, 200]);
};

/** Heavy thump — committal action like "Finish Workout". */
export const hapticHeavy = (): void => {
  if (isNative()) {
    void Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
    return;
  }
  webBuzz([80]);
};

/** Soft tap — navigation between weeks / days in the dashboard. */
export const hapticNav = (): void => {
  if (isNative()) {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    return;
  }
  webBuzz(15);
};
