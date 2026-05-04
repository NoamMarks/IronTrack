import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { isNative } from '../lib/platform';

/**
 * Capacitor `appUrlOpen` listener.
 *
 * When the OS hands a deep link to the IronTrack app (Android App Link
 * matching `https://irontrack.vercel.app/signup?invite=...` from the manifest
 * intent filter, or the assetlinks.json-verified URL pattern), Capacitor
 * fires `appUrlOpen` with the full URL.
 *
 * We extract the path + query string and push it into `window.history` so
 * the SPA reads `window.location.pathname` / `.search` exactly the way it
 * does in the browser — `SignupPage` already reads `?invite=` from the URL
 * with no special-casing required.
 *
 * No-op on web; the listener is only installed when running inside
 * Capacitor.
 */
export function useDeepLinks(): void {
  useEffect(() => {
    if (!isNative()) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void App.addListener('appUrlOpen', (event) => {
      if (cancelled) return;
      try {
        const url = new URL(event.url);
        const next = `${url.pathname}${url.search}${url.hash}`;
        // pushState so the back stack works; the SPA's existing routing
        // logic reads location on the next render.
        window.history.pushState({}, '', next || '/');
        // Fire a popstate so any listeners that watch URL changes (we use
        // popstate for our route-snapshot restore) re-evaluate.
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch {
        /* malformed URL — ignore */
      }
    }).then((handle) => {
      cleanup = () => {
        void handle.remove();
      };
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);
}
