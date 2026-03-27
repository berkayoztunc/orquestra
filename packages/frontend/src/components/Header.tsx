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
            <Link to="/docs/sign-and-send" className="text-gray-400 hover:text-primary transition-colors text-sm font-medium">
              Docs
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
                className="text-gray-400 hover:text-primary transition-colors text-sm font-medium py-2"
              >
                Docs
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
