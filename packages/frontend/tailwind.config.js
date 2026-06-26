import typography from '@tailwindcss/typography'

const colorVar = (name) => `rgb(var(${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // launch.solana inspired palette
        bg1: colorVar('--rgb-bg1'),
        cream: colorVar('--rgb-cream'),
        sand: {
          50: colorVar('--rgb-sand-50'),
          100: colorVar('--rgb-sand-100'),
          200: colorVar('--rgb-sand-200'),
          300: colorVar('--rgb-sand-300'),
          400: colorVar('--rgb-sand-400'),
          500: colorVar('--rgb-sand-500'),
          600: colorVar('--rgb-sand-600'),
          700: colorVar('--rgb-sand-700'),
          800: colorVar('--rgb-sand-800'),
          900: colorVar('--rgb-sand-900'),
          1000: colorVar('--rgb-sand-1000'),
          1100: colorVar('--rgb-sand-1100'),
          1200: colorVar('--rgb-sand-1200'),
          1300: colorVar('--rgb-sand-1300'),
          1400: colorVar('--rgb-sand-1400'),
          1500: colorVar('--rgb-sand-1500'),
          1600: colorVar('--rgb-sand-1600'),
        },
        border: {
          low: colorVar('--rgb-border-low'),
          medium: colorVar('--rgb-border-medium'),
          strong: colorVar('--rgb-border-strong'),
        },

        // legacy aliases so existing components keep working
        canvas: colorVar('--rgb-bg1'),
        paper: colorVar('--rgb-sand-100'),
        ivory: colorVar('--rgb-sand-100'),
        line: colorVar('--rgb-border-low'),
        grid: colorVar('--rgb-border-medium'),
        ink: colorVar('--rgb-sand-1600'),
        'soft-graphite': colorVar('--rgb-sand-1500'),
        'muted-ink': colorVar('--rgb-sand-1200'),
        stone: colorVar('--rgb-sand-300'),
        taupe: colorVar('--rgb-sand-700'),
        'success-stone': '#8c7972',
        'danger-coral': '#b75000',
        primary: colorVar('--rgb-sand-1600'),
        secondary: colorVar('--rgb-sand-1200'),
        accent: '#b75000',
        dark: {
          50: colorVar('--rgb-sand-50'),
          100: colorVar('--rgb-sand-100'),
          200: colorVar('--rgb-sand-200'),
          300: colorVar('--rgb-sand-300'),
          400: colorVar('--rgb-sand-400'),
          500: colorVar('--rgb-sand-700'),
          600: colorVar('--rgb-sand-900'),
          700: colorVar('--rgb-sand-1200'),
          800: colorVar('--rgb-sand-1500'),
          850: colorVar('--rgb-sand-1500'),
          900: colorVar('--rgb-sand-1600'),
          950: colorVar('--rgb-bg1'),
        },
        surface: {
          DEFAULT: colorVar('--rgb-bg1'),
          elevated: colorVar('--rgb-sand-100'),
          card: colorVar('--rgb-cream'),
        },
      },
      fontFamily: {
        sans: ['Inter', 'Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Inter', 'Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Berkeley Mono"', '"JetBrains Mono"', 'SFMono-Regular', 'ui-monospace', 'Menlo', 'monospace'],
      },
      fontSize: {
        'h1-mobile': ['36px', { lineHeight: '1.1', letterSpacing: '-0.025em' }],
        'h1-desktop': ['64px', { lineHeight: '1.05', letterSpacing: '-0.03em' }],
        'h2-mobile': ['29px', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
        'h2-desktop': ['44px', { lineHeight: '1.1', letterSpacing: '-0.025em' }],
      },
      borderRadius: {
        xs: '0.125rem',
        sm: '0.25rem',
        DEFAULT: '0.375rem',
        md: '0.5rem',
        lg: '0.625rem',
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'pulse-line-h': 'pulse-line-h 6s ease-in-out infinite',
        'pulse-line-v': 'pulse-line-v 6s ease-in-out 1.5s infinite',
        'pulse-primary': 'pulse-primary 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slide-up 0.3s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        marquee: 'marquee 35s linear infinite',
        float: 'float 3s ease-in-out infinite',
        'stagger-in': 'stagger-in 0.35s ease-out both',
      },
      keyframes: {
        'pulse-line-h': {
          '0%': { transform: 'translateX(0)', opacity: '0' },
          '15%': { opacity: '0.8' },
          '85%': { opacity: '0.8' },
          '100%': { transform: 'translateX(100vw)', opacity: '0' },
        },
        'pulse-line-v': {
          '0%': { transform: 'translateY(0)', opacity: '0' },
          '15%': { opacity: '0.8' },
          '85%': { opacity: '0.8' },
          '100%': { transform: 'translateY(100vh)', opacity: '0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(var(--float-offset, 4px))' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'pulse-primary': {
          '0%, 100%': { opacity: '1', color: 'rgb(var(--rgb-sand-1600))' },
          '50%': { opacity: '.7', color: 'rgb(var(--rgb-sand-1200))' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'stagger-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hatch-diagonal': 'repeating-linear-gradient(-45deg, transparent, transparent 10px, rgb(var(--rgb-border-low)) 10px, rgb(var(--rgb-border-low)) 11px)',
        'hatch-diagonal-strong': 'repeating-linear-gradient(-45deg, transparent, transparent 8px, rgb(var(--rgb-border-medium)) 8px, rgb(var(--rgb-border-medium)) 9px)',
        'top-fade': 'linear-gradient(to bottom, rgb(var(--rgb-highlight) / 0.6), transparent)',
      },
      backgroundSize: {
        grid: '232px 232px',
      },
      boxShadow: {
        rail: '0 1px 0 rgb(var(--rgb-sand-1600) / 0.04)',
        'card-soft': '0 1px 2px rgb(var(--rgb-sand-1600) / 0.04)',
      },
    },
  },
  plugins: [
    typography,
  ],
}
