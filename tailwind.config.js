/** @type {import('tailwindcss').Config} */
import typography from '@tailwindcss/typography';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 中性色调改为引用 CSS 变量：夜间模式只需换一组变量值，
        // 全项目的 bg-/text-/border-neutral-* 就会自动跟着变，
       // 不用在每个组件上写 dark: 前缀。
        neutral: {
          50: 'rgb(var(--c-neutral-50) / <alpha-value>)',
          100: 'rgb(var(--c-neutral-100) / <alpha-value>)',
          200: 'rgb(var(--c-neutral-200) / <alpha-value>)',
          300: 'rgb(var(--c-neutral-300) / <alpha-value>)',
          400: 'rgb(var(--c-neutral-400) / <alpha-value>)',
          500: 'rgb(var(--c-neutral-500) / <alpha-value>)',
          600: 'rgb(var(--c-neutral-600) / <alpha-value>)',
          700: 'rgb(var(--c-neutral-700) / <alpha-value>)',
          800: 'rgb(var(--c-neutral-800) / <alpha-value>)',
          900: 'rgb(var(--c-neutral-900) / <alpha-value>)',
          950: 'rgb(var(--c-neutral-950) / <alpha-value>)',
        },
        // 保留一些基础色调用于强调
        accent: {
          50: '#f5f5f5',
          100: '#e6e6e6',
          200: '#cccccc',
          300: '#b3b3b3',
          400: '#999999',
          500: '#808080',
          600: '#666666',
          700: '#4d4d4d',
          800: '#333333',
          900: '#1a1a1a',
          950: '#0d0d0d',
        },
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
      borderWidth: {
        '0.5': '0.5px',
      },
      boxShadow: {
        'subtle': '0 1px 3px rgba(0,0,0,0.05)',
        'minimal': '0 1px 2px rgba(0,0,0,0.03)',
      },
    },
  },
  plugins: [
    typography,
  ],
};
