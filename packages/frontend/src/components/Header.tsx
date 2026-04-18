import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { getGitHubLoginUrl } from '../api/client'

export default function Header(): JSX.Element {
  const { isAuthenticated, user, logout, isLoading } = useAuthStore()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const closeMobileMenu = () => setMobileMenuOpen(false)

  return (
    <header className="fixed top-0 left-0 right-0 z-40 glass border-b border-white/5">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
        <div className="flex justify-between items-center">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 group" onClick={closeMobileMenu}>
            <img 
              src="/logo.png" 
              alt="orquestra logo" 
              className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl object-contain"
            />
            <span className="text-lg sm:text-xl font-bold text-white group-hover:text-primary transition-colors">
              Orquestra
            </span>
          </Link>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            <Link to="/" className="text-gray-400 hover:text-primary transition-colors text-sm font-medium">
              Home
            </Link>
            <Link to="/explorer" className="text-gray-400 hover:text-primary transition-colors text-sm font-medium">
              Explorer
            </Link>
              {/* Docs dropdown */}
              <div className="relative group">
                <button
                  type="button"
                  aria-haspopup="true"
                  className="flex items-center gap-1 text-gray-300 hover:text-primary transition-colors text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-dark-800 rounded"
                >
                  Docs
                  <svg
                    className="w-3.5 h-3.5 transition-transform duration-150 group-hover:rotate-180 group-focus-within:rotate-180"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                <div
                  className="absolute top-full left-1/2 -translate-x-1/2 pt-2 w-52 z-50 opacity-0 invisible pointer-events-none translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:visible group-hover:pointer-events-auto group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto group-focus-within:translate-y-0"
                  role="menu"
                >
                  <div className="rounded-xl border border-white/10 bg-dark-900/95 backdrop-blur-md shadow-xl py-1.5">
                    <Link
                      to="/docs/sign-and-send"
                      role="menuitem"
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-300 hover:text-primary hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:bg-primary/10"
                    >
                      <svg className="w-4 h-4 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      Sign &amp; Send
                    </Link>
                    <Link
                      to="/docs/mcp"
                      role="menuitem"
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-300 hover:text-primary hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:bg-primary/10"
                    >
                      <svg className="w-4 h-4 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      MCP Server
                    </Link>
                    <Link
                      to="/docs/cli"
                      role="menuitem"
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-300 hover:text-primary hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:bg-primary/10"
                    >
                      <svg className="w-4 h-4 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      CLI
                    </Link>
                  </div>
                </div>
              </div>
            {isAuthenticated ? (
              <>
                <Link to="/dashboard" className="text-gray-400 hover:text-primary transition-colors text-sm font-medium">
                  Dashboard
                </Link>
                <div className="flex items-center gap-4 pl-4 border-l border-white/10">
                  {user?.avatar_url && (
                    <img
                      src={user.avatar_url}
                      alt={user.username}
                      className="w-8 h-8 rounded-lg border border-white/10"
                    />
                  )}
                  <span className="text-sm text-gray-300 font-medium">{user?.username}</span>
                  <button
                    onClick={logout}
                    className="text-sm text-gray-500 hover:text-red-400 transition-colors"
                  >
                    Logout
                  </button>
                </div>
              </>
            ) : !isLoading ? (
              <a
                href={getGitHubLoginUrl()}
                className="btn-primary text-sm px-5 py-2.5"
              >
                Sign in
              </a>
            ) : null}
            {/* GitHub star */}
            <a
              href="https://github.com/berkayoztunc/orquestra"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 hover:text-white transition-all duration-200"
              aria-label="Star on GitHub"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              Star
            </a>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-gray-400 hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {mobileMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div id="mobile-nav" className="md:hidden mt-4 pb-4 border-t border-white/5 pt-4">
            <div className="flex flex-col gap-4">
              <Link
                to="/"
                onClick={closeMobileMenu}
                className="text-gray-400 hover:text-primary transition-colors text-sm font-medium py-2"
              >
                Home
              </Link>
              <Link
                to="/explorer"
                onClick={closeMobileMenu}
                className="text-gray-400 hover:text-primary transition-colors text-sm font-medium py-2"
              >
                Explorer
              </Link>
                <Link
                  to="/docs/sign-and-send"
                  onClick={closeMobileMenu}
                  className="text-gray-300 hover:text-primary transition-colors text-sm font-medium py-2 pl-2"
                >
                  Docs - Sign &amp; Send
                </Link>
                <Link
                  to="/docs/mcp"
                  onClick={closeMobileMenu}
                  className="text-gray-300 hover:text-primary transition-colors text-sm font-medium py-2 pl-2"
                >
                  Docs - MCP Server
                </Link>
                <Link
                  to="/docs/cli"
                  onClick={closeMobileMenu}
                  className="text-gray-300 hover:text-primary transition-colors text-sm font-medium py-2 pl-2"
                >
                  Docs - CLI
                </Link>
              {isAuthenticated ? (
                <>
                  <Link
                    to="/dashboard"
                    onClick={closeMobileMenu}
                    className="text-gray-400 hover:text-primary transition-colors text-sm font-medium py-2"
                  >
                    Dashboard
                  </Link>
                  <div className="flex items-center gap-3 py-2 border-t border-white/5 mt-2 pt-4">
                    {user?.avatar_url && (
                      <img
                        src={user.avatar_url}
                        alt={user.username}
                        className="w-8 h-8 rounded-lg border border-white/10"
                      />
                    )}
                    <span className="text-sm text-gray-300 font-medium flex-1">{user?.username}</span>
                    <button
                      onClick={() => {
                        logout()
                        closeMobileMenu()
                      }}
                      className="text-sm text-gray-500 hover:text-red-400 transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                </>
              ) : !isLoading ? (
                <a
                  href={getGitHubLoginUrl()}
                  onClick={closeMobileMenu}
                  className="btn-primary text-sm px-5 py-2.5 text-center mt-2"
                >
                  Sign in
                </a>
              ) : null}
            </div>
          </div>
        )}
      </nav>
    </header>
  )
}
