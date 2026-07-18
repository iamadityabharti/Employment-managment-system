import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#17221d',
        canvas: '#f5f7f4',
        line: '#dfe7df',
        moss: {
          50: '#edf8f0',
          100: '#d9f0df',
          500: '#268b59',
          600: '#1e7148',
          700: '#185a3b'
        },
        sunflower: {
          50: '#fff9e9',
          100: '#fff0bd',
          500: '#bd7b11',
          600: '#975f0d'
        },
        coral: {
          50: '#fff1ee',
          100: '#ffdcd5',
          500: '#c4523f',
          600: '#a33f30'
        }
      },
      boxShadow: {
        panel: '0 1px 2px rgba(23, 34, 29, 0.04), 0 8px 24px rgba(23, 34, 29, 0.05)'
      }
    }
  },
  plugins: []
} satisfies Config;
