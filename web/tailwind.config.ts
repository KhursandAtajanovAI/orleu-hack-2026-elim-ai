import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#0F766E', dark: '#115E59', light: '#CCFBF1' },
        // 3D-карта и 3D-цех (потоки D, E): цвета из CSS-переменных, светлая/тёмная тема через data-theme
        ink: 'rgb(var(--ink) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
      },
    },
  },
  plugins: [],
} satisfies Config;
