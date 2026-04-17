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
                  </div>
                </div>
              </div>
            <Link to="/cli" className="text-gray-400 hover:text-primary transition-colors text-sm font-medium">
              CLI
            </Link>
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
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-gray-400 hover:text-primary transition-colors"
            aria-label="Toggle menu"
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
          <div className="md:hidden mt-4 pb-4 border-t border-white/5 pt-4">
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
                to="/cli"
                onClick={closeMobileMenu}
                className="text-gray-400 hover:text-primary transition-colors text-sm font-medium py-2"
              >
                CLI
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
