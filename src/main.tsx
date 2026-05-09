import React from 'react';
import ReactDOM from 'react-dom/client';
import { LazyMotion, domAnimation } from 'motion/react';
import * as Sentry from '@sentry/react';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { PrivacyPolicy } from './components/static/PrivacyPolicy';
import { AppErrorBoundary } from './components/ErrorBoundary';
import { isNative } from './lib/platform';
import './index.css';

// Sentry: opt-in via VITE_SENTRY_DSN. When the env var is unset (e.g. local
// dev) the SDK is initialised but disabled, so calls become cheap no-ops
// rather than failing imports. `beforeSend` strips email-shaped strings from
// breadcrumb messages so trainee/coach emails don't leak into the dashboard.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // event.breadcrumbs IS the array in @sentry/react v10+ — no nested
    // `.values` field. Strip email-shaped substrings from breadcrumb
    // messages so trainee/coach emails don't leak into the dashboard.
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((b) => ({
        ...b,
        message: b.message?.replace(
          /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
          '[email]',
        ),
      }));
    }
    return event;
  },
});

// Static routes are dispatched here, before React mounts the auth shell, so
// they don't have to share its hook tree. Adding a new static page = one
// pathname check + one component import.
const Root = window.location.pathname === '/privacy' ? <PrivacyPolicy /> : <App />;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <LazyMotion features={domAnimation}>
        {Root}
      </LazyMotion>
    </AppErrorBoundary>
  </React.StrictMode>,
);

// PWA service worker — web only. Capacitor's native WebView serves assets
// over its own scheme and ships its own offline delivery, so registering
// here would either no-op or fight the native bundle. `immediate: true`
// kicks off registration on first paint instead of waiting for window load,
// which shaves a few seconds off the install-prompt eligibility window.
if (!isNative()) {
  registerSW({ immediate: true });
}
