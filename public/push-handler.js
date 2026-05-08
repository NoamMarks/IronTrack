/**
 * Push notification handler.
 *
 * Imported by the Workbox-generated service worker via vite.config.ts →
 * workbox.importScripts. Runs in the SW context (`self` is the
 * ServiceWorkerGlobalScope).
 *
 * Responsibilities:
 *   - 'push' event: render a notification using the JSON payload from the
 *     server (or a sane default when the payload is missing / malformed).
 *   - 'notificationclick': focus an open IronTrack window if there is one,
 *     otherwise open a new one at the URL embedded in the notification.
 *
 * This file is plain JS (not TS) on purpose — Workbox's importScripts
 * loads the file at runtime, no bundler step in between.
 */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Some senders pass a plain text body. Treat it as the notification
    // body so the user still sees something useful.
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'IronTrack';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    data: { url: payload.url || '/' },
    // tag collapses repeated pushes (e.g. several rest-timer reminders)
    // into a single visible notification.
    tag: payload.tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
