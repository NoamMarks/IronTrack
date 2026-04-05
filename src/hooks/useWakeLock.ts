import { useState, useEffect, useCallback, useRef } from 'react';

export function useWakeLock() {
  const [isActive, setIsActive] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const request = useCallback(async () => {
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

  // Re-acquire on visibility change (tab back in)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isActive && !wakeLockRef.current) {
        void request();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isActive, request]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { void release(); };
  }, [release]);

  return { isActive, toggle, isSupported: 'wakeLock' in navigator };
}
