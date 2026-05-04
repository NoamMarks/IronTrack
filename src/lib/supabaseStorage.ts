/**
 * Capacitor-backed storage adapter for the Supabase auth client.
 *
 * Web uses the default `localStorage` adapter, which loses the session if the
 * user clears site data. Inside a Capacitor WebView we route auth tokens
 * through `@capacitor/preferences` — backed by EncryptedSharedPreferences on
 * Android — so the session survives app-data clears short of a full
 * uninstall.
 *
 * Wired in `supabase.ts` only when `isNative()` is true, so the web build
 * keeps using localStorage (vitest / Playwright unaffected).
 */
import { Preferences } from '@capacitor/preferences';
import type { GoTrueClientOptions } from '@supabase/supabase-js';

export const capacitorStorage: NonNullable<GoTrueClientOptions['storage']> = {
  getItem: async (key) => (await Preferences.get({ key })).value,
  setItem: async (key, value) => {
    await Preferences.set({ key, value });
  },
  removeItem: async (key) => {
    await Preferences.remove({ key });
  },
};
