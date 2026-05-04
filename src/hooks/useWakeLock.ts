import { useState, useEffect, useCallback, useRef } from 'react';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { isNative } from '../lib/platform';

/**
 * Keep-the-screen-on hook for Gym Mode.
 *
 * Two backends:
 *   - **Native (Capacitor):** `@capacitor-community/keep-awake` holds an
 *     Android `WindowManager.FLAG_KEEP_SCREEN_ON` flag. Reliable, supported
 *     on every Android version we target.
 *   - **Web:** the standard `navigator.wakeLock` API, gated on browser
 *     support. Returns a `WakeLockSentinel` that we release on unmount /
 *     toggle / visibility change.
 *
 * Either way, the UI just calls `toggle()` and reads `isActive` — the
 * branching stays inside this hook.
 */
export function useWakeLock() {
  const [isActive, setIsActive] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const request = useCallback(async () => {
    if (isNative()) {
      try {
        await KeepAwake.keepAwake();
        setIsActive(true);
      } catch {
        setIsActive(false);
      }
      return;
    }
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      setIsActive(true);
      wakeLockRef.current.addEventListener('release', () => setIsActive(false));
    } catch {
      setIsActive(false);
    }
  }, []);

  const release = useCallback(async () => {
    if (isNative()) {
      try {
        await KeepAwake.allowSleep();
      } catch {
        /* ignore */
      }
      setIsActive(false);
      return;
    }
    if (wakeLockRef.current) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
      setIsActive(false);
    }
  }, []);

  const toggle = useCallback(async () => {
    if (isActive) {
      await release();
    } else {
      await request();
    }
  }, [isActive, request, release]);

  useEffect(() => {
    if (isNative()) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isActive && !wakeLockRef.current) {
        void request();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isActive, request]);

  useEffect(() => {
    return () => {
      void release();
    };
  }, [release]);

  return {
    isActive,
    toggle,
    isSupported: isNative() || 'wakeLock' in navigator,
  };
}
