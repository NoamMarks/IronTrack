import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Auto-update keeps every web tab on the freshest build without an
      // intrusive "reload" prompt. Workbox claims clients on activation and
      // skips waiting, so the next route navigation already runs the new
      // bundle.
      registerType: 'autoUpdate',
      // We register the SW explicitly from src/main.tsx (gated on
      // !isNative), so disable the plugin's auto-injected <script>.
      injectRegister: false,
      // The hashed app shell + Workbox-cached assets cover offline. Bump
      // the precache size cap a little — the brutalist UI ships a few
      // largeish font files alongside the JS bundle.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,png,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'IronTrack',
        short_name: 'IronTrack',
        description: 'Unified Training Management System for coaches and trainees.',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        // PNGs generated from public/favicon.svg via `npm run icons:generate`
        // (see pwa-assets.config.ts). Re-run after editing the source SVG.
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/maskable-icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  define: {
    // Surfaced in the dashboard footer (e.g. ClientDashboard's "IronTrack
    // v{__APP_VERSION__}") so users can report which build they're on.
    // The prebuild hook in package.json bumps pkg.version before this is
    // read, so production builds stamp a fresh number every time.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
  },
});
