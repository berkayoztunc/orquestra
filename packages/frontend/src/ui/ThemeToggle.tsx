import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { cn } from './cn'

type Theme = 'light' | 'dark'

const storageKey = 'orquestra-theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'

  const storedTheme = window.localStorage.getItem(storageKey)
  if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme): void {
  const isDark = theme === 'dark'
  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.style.colorScheme = theme
  window.localStorage.setItem(storageKey, theme)

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (themeColor) {
    themeColor.content = isDark ? '#171614' : '#faf9f7'
  }
}

export function ThemeToggle({ className }: { className?: string }): JSX.Element {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const isDark = theme === 'dark'

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <button
      type="button"
      role="switch"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-checked={isDark}
      title={isDark ? 'Light mode' : 'Dark mode'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={cn(
        'relative inline-flex h-9 w-[4.5rem] shrink-0 items-center border border-border-low bg-bg1 p-0.5 transition-colors hover:border-border-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-bg1',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-0.5 w-[calc(50%-2px)] bg-sand-200 transition-transform duration-200 ease-in-out',
          isDark && 'translate-x-[calc(100%+2px)]',
        )}
      />
      <span className={cn('relative z-10 flex h-full w-1/2 items-center justify-center transition-colors duration-200', !isDark ? 'text-sand-1600' : 'text-sand-1000')}>
        <Sun className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className={cn('relative z-10 flex h-full w-1/2 items-center justify-center transition-colors duration-200', isDark ? 'text-sand-1600' : 'text-sand-1000')}>
        <Moon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </button>
  )
}
