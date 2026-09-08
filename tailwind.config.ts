import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#08090b',
          900: '#0d0f13',
          850: '#12151a',
          800: '#171b22',
          700: '#1f242d',
          600: '#2b323d',
          500: '#3b444f',
          400: '#5b6675',
          300: '#8b97a6',
          200: '#b9c3cf',
          100: '#e3e9ef',
        },
        signal: { DEFAULT: '#4fd1c5', dim: '#2b7a72' },
        warn: { DEFAULT: '#f0a35e' },
        bad: { DEFAULT: '#e2576f' },
        good: { DEFAULT: '#5ec98b' },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: { '2xs': ['0.6875rem', '0.9rem'] },
    },
  },
  plugins: [],
};
export default config;
