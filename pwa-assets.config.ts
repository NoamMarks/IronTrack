import { defineConfig } from '@vite-pwa/assets-generator/config';

// Rasterize public/favicon.svg into the four PWA manifest assets the iOS +
// Android home-screen install flow expects. Keep the brutalist palette
// (#09090b background, white dumbbell) consistent with capacitor.config.ts
// SplashScreen.backgroundColor and the index.html theme-color meta.
//
// Re-run via `npm run icons:generate` whenever public/favicon.svg changes.

const BG = '#09090b';

export default defineConfig({
  preset: {
    transparent: {
      sizes: [192, 512],
      favicons: [],
    },
    maskable: {
      // Source SVG is already framed (full-bleed bg, dumbbell occupies the
      // center ~62%), so no extra padding — the launcher's circle/squircle
      // mask still leaves the mark fully visible.
      sizes: [512],
      padding: 0,
      resizeOptions: { background: BG, fit: 'contain' },
    },
    apple: {
      sizes: [180],
      padding: 0,
      resizeOptions: { background: BG, fit: 'contain' },
    },
    // Single top-level function applied per (type, size). The "icons/"
    // prefix routes outputs into public/icons/ since paths are joined
    // against dirname(source) = public/.
    assetName: (type, size) => {
      if (type === 'transparent') return `icons/icon-${size.width}x${size.height}.png`;
      if (type === 'maskable') return 'icons/maskable-icon.png';
      if (type === 'apple') return 'icons/apple-touch-icon.png';
      return `icons/${type}-${size.width}x${size.height}.png`;
    },
  },
  images: ['public/favicon.svg'],
});
