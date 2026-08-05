/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{njk,md,js}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        "surface-hover": "var(--color-surface-hover)",
        border: "var(--color-border)",
        "border-hover": "var(--color-border-hover)",
        accent: {
          400: "var(--color-accent-400)",
          500: "var(--color-accent-500)",
          600: "var(--color-accent-600)",
        },
        win: "var(--color-win)",
        loss: "var(--color-loss)",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
      },
      fontFamily: {
        sans: ["Manrope", "Inter", "sans-serif"],
        display: ["'Barlow Condensed'", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
      },
    },
  },
  plugins: [],
};
