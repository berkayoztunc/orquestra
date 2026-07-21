import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, Github, Menu, X } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { getGitHubLoginUrl } from '../api/client'
import { buttonClassName } from '@/ui/Button'
import { Logo } from '@/ui/Logo'
import { ThemeToggle } from '@/ui/ThemeToggle'
import { cn } from '@/ui/cn'

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/explorer', label: 'Explorer' },
  { to: '/flows', label: 'Flows' },
  { to: '/docs/api', label: 'Docs' },
]

// Grouped under the "Analytics" dropdown — these were all top-level items
// before; collecting them keeps the primary nav short.
const analyticsMenuItems = [
  { to: '/analytics', label: 'Analytics' },
  { to: '/updates', label: 'Updates' },
  { to: '/sync', label: 'Sync' },
]

const docsItems = [
  { to: '/docs/api', label: 'API' },
  { to: '/docs/sign-and-send', label: 'Sign & Send' },
  { to: '/docs/mcp', label: 'MCP Server' },
  { to: '/docs/cli', label: 'CLI' },
  { to: '/docs/flow-engine', label: 'Flow Engine' },
]

function navClassName({ isActive }: { isActive: boolean }): string {
  return cn(
    'block px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400',
    isActive
      ? 'bg-sand-1600 text-bg1'
      : 'text-sand-1200 hover:bg-sand-100 hover:text-sand-1600',
  )
}

function AnalyticsMenu(): JSX.Element {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const isActive = analyticsMenuItems.some((item) => location.pathname === item.to)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  // Close on navigation
  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-1 px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400',
          isActive ? 'bg-sand-1600 text-bg1' : 'text-sand-1200 hover:bg-sand-100 hover:text-sand-1600',
        )}
      >
        Analytics
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-150', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-40 border border-border-low bg-bg1 py-1 shadow-lg"
        >
          {analyticsMenuItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              role="menuitem"
              className={({ isActive: linkActive }) =>
                cn(
                  'block px-3 py-2 text-sm transition-colors duration-150',
                  linkActive ? 'bg-sand-1600 text-bg1' : 'text-sand-1200 hover:bg-sand-100 hover:text-sand-1600',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function Header(): JSX.Element {
  const { isAuthenticated, user, logout, isLoading } = useAuthStore()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const closeMobileMenu = () => setMobileMenuOpen(false)

  return (
    <header className="sticky top-0 z-40 px-4 sm:px-6 lg:px-8">
      <nav
        className="mx-auto max-w-7xl border-x border-b border-border-low bg-bg1/70 px-4 py-3 backdrop-blur-md sm:px-6"
        aria-label="Primary"
      >
        <div className="flex h-12 items-center justify-between gap-4">
          <Logo markClassName="h-8 w-8" />

          <div className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={navClassName}>
                {item.label}
              </NavLink>
            ))}

            <AnalyticsMenu />

            {isAuthenticated ? (
              <>
                <NavLink to="/dashboard" className={navClassName}>
                  Dashboard
                </NavLink>
                <NavLink to="/lists" className={navClassName}>
                  My Lists
                </NavLink>
              </>
            ) : null}
            {isAuthenticated ? (
              <div className="flex items-center gap-3 border-l border-border-low pl-3">
                {user?.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.username}
                    className="h-7 w-7 rounded-full border border-border-low object-cover"
                  />
                ) : null}
                <span className="max-w-28 truncate text-sm font-medium text-sand-1500">
                  {user?.username}
                </span>
                <button
                  onClick={logout}
                  className="min-h-9 px-3 text-sm text-sand-1200 transition-colors hover:bg-sand-100 hover:text-sand-1600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400"
                >
                  Logout
                </button>
              </div>
            ) : !isLoading ? (
              <a href={getGitHubLoginUrl()} className={buttonClassName({ size: 'sm' })}>
                Sign in
              </a>
            ) : null}

            <a
              href="https://github.com/berkayoztunc/orquestra"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-9 items-center gap-2 border border-border-low bg-bg1 px-3 text-sm font-medium text-sand-1200 transition-colors hover:border-border-medium hover:bg-sand-100 hover:text-sand-1600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400"
              aria-label="Star Orquestra on GitHub"
            >
              <Github className="h-4 w-4" aria-hidden="true" />
              Star
            </a>
            <ThemeToggle />
          </div>


          <div className="flex items-center gap-2 md:hidden">
            <ThemeToggle />
            <button
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="inline-flex min-h-10 min-w-10 items-center justify-center border border-border-low bg-bg1 text-sand-1500 transition-colors hover:border-border-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-bg1"
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen ? (
          <div
            id="mobile-nav"
            className="mt-3 border border-border-low bg-bg1 p-2 md:hidden"
          >
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} onClick={closeMobileMenu} className={navClassName}>
                {item.label}
              </NavLink>
            ))}

            <p className="mt-2 px-3 pt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-sand-1100">
              Analytics
            </p>
            {analyticsMenuItems.map((item) => (
              <NavLink key={item.to} to={item.to} onClick={closeMobileMenu} className={navClassName}>
                {item.label}
              </NavLink>
            ))}

            <p className="mt-2 px-3 pt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-sand-1100">
              Docs
            </p>
            {docsItems.map((item) => (
              <NavLink key={item.to} to={item.to} onClick={closeMobileMenu} className={navClassName}>
                {item.label}
              </NavLink>
            ))}

            {isAuthenticated ? (
              <>
                <NavLink to="/dashboard" onClick={closeMobileMenu} className={navClassName}>
                  Dashboard
                </NavLink>
                <NavLink to="/lists" onClick={closeMobileMenu} className={navClassName}>
                  My Lists
                </NavLink>
                <div className="mt-2 flex items-center gap-3 border-t border-border-low px-3 pt-3">
                  {user?.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt={user.username}
                      className="h-7 w-7 rounded-full border border-border-low"
                    />
                  ) : null}
                  <span className="flex-1 truncate text-sm font-medium text-sand-1500">
                    {user?.username}
                  </span>
                  <button
                    onClick={() => {
                      logout()
                      closeMobileMenu()
                    }}
                    className="min-h-9 px-3 text-sm text-sand-1200 hover:text-sand-1600"
                  >
                    Logout
                  </button>
                </div>
              </>
            ) : !isLoading ? (
              <a
                href={getGitHubLoginUrl()}
                onClick={closeMobileMenu}
                className={buttonClassName({ className: 'mt-2 w-full' })}
              >
                Sign in
              </a>
            ) : null}
          </div>
        ) : null}
      </nav>
    </header>
  )
}
