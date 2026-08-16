/** @type {import('tailwindcss').Config} */
export default {
  // lib/ is in scope because the Rankings tab's markup lives in
  // lib/rankings-markup.js (shared by the build and the live-season redraw) —
  // without it Tailwind purges every `rank-*` component rule in main.css.
  content: ["./src/**/*.{njk,md,js}", "./lib/**/*.js"],
  darkMode: "class",
  // Position classes are built dynamically (`pos-pill-{{ p.position }}`), so
  // Tailwind's content scanner never sees the literal class names and would
  // otherwise purge the component rules in main.css.
  safelist: [{ pattern: /^pos-(pill-)?(QB|RB|WR|TE|K|DEF|NA)$/ }],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--color-bg) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-hover": "rgb(var(--color-surface-hover) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        "border-hover": "rgb(var(--color-border-hover) / <alpha-value>)",
        accent: {
          400: "rgb(var(--color-accent-400) / <alpha-value>)",
          500: "rgb(var(--color-accent-500) / <alpha-value>)",
          600: "rgb(var(--color-accent-600) / <alpha-value>)",
        },
        win: "rgb(var(--color-win) / <alpha-value>)",
        loss: "rgb(var(--color-loss) / <alpha-value>)",
        "text-primary": "rgb(var(--color-text-primary) / <alpha-value>)",
        "text-secondary": "rgb(var(--color-text-secondary) / <alpha-value>)",
        "text-muted": "rgb(var(--color-text-muted) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Manrope", "Inter", "sans-serif"],
        display: ["'Barlow Condensed'", "sans-serif"],
        sport: ["Anton", "'Barlow Condensed'", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
      },
    },
  },
  plugins: [],
};
