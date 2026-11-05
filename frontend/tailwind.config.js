/** Tailwind utilities resolve to CSS tokens so component styles share the same theme source. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        panel: 'var(--color-panel)',
        text: 'var(--color-text)',
        muted: 'var(--color-muted)',
        accent: 'var(--color-accent)',
        border: 'var(--color-border)',
        ok: 'var(--color-ok)',
        warn: 'var(--color-warn)',
        danger: 'var(--color-danger)',
        info: 'var(--color-info)',
      },
      fontFamily: { sans: 'var(--font-family)' },
      fontSize: {
        base: 'var(--font-size-base)',
        body: 'var(--font-size-body)',
        small: 'var(--font-size-small)',
        h1: 'var(--font-size-h1)',
        h2: 'var(--font-size-h2)',
      },
      lineHeight: {
        body: 'var(--line-height-body)',
        heading: 'var(--line-height-heading)',
      },
      spacing: {
        1: 'var(--space-1)', 2: 'var(--space-2)', 3: 'var(--space-3)',
        4: 'var(--space-4)', 5: 'var(--space-5)', 6: 'var(--space-6)',
        8: 'var(--space-8)', 10: 'var(--space-10)', 12: 'var(--space-12)',
      },
      minHeight: { tap: 'var(--tap-target)' },
      minWidth: { tap: 'var(--tap-target)' },
      borderRadius: {
        sm: 'var(--radius-small)',
        card: 'var(--radius-card)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: { card: 'var(--shadow-card)' },
      transitionDuration: { DEFAULT: 'var(--motion-duration)' },
    },
  },
  plugins: [],
};
