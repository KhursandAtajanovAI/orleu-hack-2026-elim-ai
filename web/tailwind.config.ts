import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: '#0F766E', dark: '#115E59', light: '#CCFBF1' } },
    },
  },
  plugins: [],
} satisfies Config;
