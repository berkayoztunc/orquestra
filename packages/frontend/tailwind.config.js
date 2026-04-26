/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#14F195',
        secondary: '#00D9FF',
        accent: '#FF3333',
        dark: {
          50: '#f5f5f5',
          100: '#e8e8eb',
          200: '#d1d1d6',
          300: '#babac5',
          400: '#a3a3b4',
          500: '#8c8ca3',
          600: '#6d6d8c',
          700: '#4e4e75',
          800: '#2f2f5e',
          850: '#1a2e25',
          900: '#0a0f0d',
          950: '#050807',
        },
        surface: {
          DEFAULT: '#0d1411',
          elevated: '#111d18',
          card: '#152219',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'xl': '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      },
      animation: {
        'pulse-primary': 'pulse-primary 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'slide-up': 'slide-up 0.3s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'marquee': 'marquee 35s linear infinite',
      },
      keyframes: {
        'marquee': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'pulse-primary': {
          '0%, 100%': { opacity: '1', color: '#14F195' },
          '50%': { opacity: '.8', color: '#10b573' },
        },
        'glow': {
          '0%': { boxShadow: '0 0 5px rgba(20, 241, 149, 0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(20, 241, 149, 0.4)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'grid-pattern': 'linear-gradient(to right, rgba(20, 241, 149, 0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(20, 241, 149, 0.03) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid': '40px 40px',
      },
    },
  },
  plugins: [],
}
