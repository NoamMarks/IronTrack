import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { PrivacyPolicy } from './components/static/PrivacyPolicy';
import { isNative } from './lib/platform';
import './index.css';

// Static routes are dispatched here, before React mounts the auth shell, so
// they don't have to share its hook tree. Adding a new static page = one
// pathname check + one component import.
const Root = window.location.pathname === '/privacy' ? <PrivacyPolicy /> : <App />;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{Root}</React.StrictMode>,
);

// PWA service worker — web only. Capacitor's native WebView serves assets
// over its own scheme and ships its own offline delivery, so registering
// here would either no-op or fight the native bundle. `immediate: true`
// kicks off registration on first paint instead of waiting for window load,
// which shaves a few seconds off the install-prompt eligibility window.
if (!isNative()) {
  registerSW({ immediate: true });
}
