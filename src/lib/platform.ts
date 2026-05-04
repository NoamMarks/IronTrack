/**
 * Platform detection helpers for native vs web builds.
 *
 * The web bundle ships in two shapes:
 *   - Browser at irontrack.vercel.app — `isNative()` is false.
 *   - Inside a Capacitor Android/iOS WebView — `isNative()` is true.
 *
 * Use `isNative()` to branch on storage adapters, wake-lock APIs, haptics,
 * and any other capability where the web fallback differs from the
 * native bridge. Keep the native imports lazy so vitest / SSR don't have
 * to resolve Capacitor packages they'll never call.
 */
import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const platform = (): 'web' | 'ios' | 'android' =>
  Capacitor.getPlatform() as 'web' | 'ios' | 'android';
