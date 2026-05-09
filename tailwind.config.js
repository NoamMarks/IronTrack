/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        surface:    'var(--color-surface)',
        card:       'var(--color-card)',
        border:     'var(--color-border)',
        primary: {
          DEFAULT:    'var(--color-primary)',
          foreground: 'var(--color-primary-foreground)',
        },
        accent: {
          DEFAULT:    'var(--color-accent)',
          foreground: 'var(--color-accent-foreground)',
        },
        muted: {
          DEFAULT:    'var(--color-muted)',
          foreground: 'var(--color-muted-foreground)',
        },
        warning:  'var(--color-warning)',
        danger:   'var(--color-danger)',
      },
      borderRadius: {
        card:  'var(--radius-card)',
        input: 'var(--radius-input)',
      },
      fontFamily: {
        sans:    ['Rajdhani', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Rajdhani', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'glow-primary': 'var(--glow-primary)',
        'glow-accent':  'var(--glow-accent)',
        'glow-danger':  'var(--glow-danger)',
        'glow-warning': 'var(--glow-warning)',
      },
      animation: {
        'fui-pulse':      'fui-pulse 2s ease-in-out infinite',
        'fui-glow-pulse': 'fui-glow-pulse 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
