import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PrivacyPolicy } from './components/static/PrivacyPolicy';
import './index.css';

// Static routes are dispatched here, before React mounts the auth shell, so
// they don't have to share its hook tree. Adding a new static page = one
// pathname check + one component import.
const Root = window.location.pathname === '/privacy' ? <PrivacyPolicy /> : <App />;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{Root}</React.StrictMode>,
);
