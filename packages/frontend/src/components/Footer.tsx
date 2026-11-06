import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUp, Check, Copy, Github, Youtube } from 'lucide-react'
import { Logo } from '@/ui/Logo'

const MCP_COMMAND = 'claude mcp add --transport http orquestra https://api.orquestra.dev/mcp'

type FooterLink = { label: string; to: string; external?: boolean }

const columns: Array<{ title: string; links: FooterLink[] }> = [
  {
    title: 'Product',
    links: [
      { label: 'Explorer', to: '/explorer' },
      { label: 'Flows', to: '/flows' },
      { label: 'Analytics', to: '/analytics' },
      { label: 'IDL Updates', to: '/updates' },
      { label: 'Sync pipeline', to: '/sync' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'API reference', to: '/docs/api' },
      { label: 'MCP server', to: '/docs/mcp' },
      { label: 'Flow Engine', to: '/docs/flow-engine' },
      { label: 'Program lists', to: '/docs/lists' },
      { label: 'CLI', to: '/docs/cli' },
      { label: 'Sign & Send', to: '/docs/sign-and-send' },
      { label: 'Packages', to: '/docs/packages' },
    ],
  },
  {
    title: 'Community',
    links: [
      { label: 'GitHub', to: 'https://github.com/berkayoztunc/orquestra', external: true },
      { label: 'X · @orquestradev', to: 'https://x.com/orquestradev', external: true },
      { label: 'X · Maintainer', to: 'https://x.com/WhiteMoonDev', external: true },
      { label: 'YouTube', to: 'https://www.youtube.com/@whitemoondev', external: true },
      { label: 'Report an issue', to: 'https://github.com/berkayoztunc/orquestra/issues', external: true },
    ],
  },
]

const linkClass =
  'inline-flex min-h-7 items-center text-sm text-sand-1200 transition-colors hover:text-sand-1600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400'

export default function Footer(): JSX.Element {
  const currentYear = new Date().getFullYear()
  const [copied, setCopied] = useState(false)

  const copyCommand = () => {
    navigator.clipboard.writeText(MCP_COMMAND).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      },
      () => undefined,
    )
  }

  return (
    <footer className="px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl border-x border-t border-border-low">
        {/* Call to action */}
        <div className="flex flex-col gap-4 border-b border-border-low px-4 py-8 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold tracking-tight text-sand-1600">Give your agent real Solana tools.</h2>
            <p className="mt-1 text-sm leading-6 text-sand-1200">One command connects Claude Code to every program in the registry. Other clients are in the docs.</p>
          </div>
          <div className="flex min-w-0 items-stretch lg:max-w-xl lg:flex-1">
            <code className="flex h-10 min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap border border-r-0 border-border-medium bg-sand-50 px-3 font-mono text-xs text-sand-1500">
              {MCP_COMMAND}
            </code>
            <button
              type="button"
              onClick={copyCommand}
              className="inline-flex h-10 shrink-0 items-center gap-2 border border-sand-1600 bg-sand-1600 px-4 text-sm font-medium text-bg1 transition-colors hover:bg-sand-1400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-bg1"
              aria-label="Copy the MCP install command"
            >
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Brand + links */}
        <div className="grid gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <Logo markClassName="h-8 w-8" />
            <p className="mt-4 max-w-sm text-sm leading-6 text-sand-1200">
              Public interfaces for private execution. Orquestra turns Solana program IDLs into an API, AI-ready docs, MCP tools and transaction builders.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <a
                href="https://github.com/berkayoztunc/orquestra"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Orquestra on GitHub"
                className="inline-flex h-9 w-9 items-center justify-center border border-border-low bg-bg1 text-sand-1200 transition-colors hover:border-border-medium hover:bg-sand-100 hover:text-sand-1600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400"
              >
                <Github className="h-4 w-4" aria-hidden="true" />
              </a>
              <a
                href="https://x.com/orquestradev"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Orquestra on X"
                title="Orquestra on X"
                className="inline-flex h-9 w-9 items-center justify-center border border-border-low bg-bg1 font-semibold text-sand-1200 transition-colors hover:border-border-medium hover:bg-sand-100 hover:text-sand-1600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400"
              >
                <span aria-hidden="true" className="text-sm leading-none">
                  𝕏
                </span>
              </a>
              <a
                href="https://x.com/WhiteMoonDev"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Maintainer, White Moon Dev, on X"
                title="Maintainer on X"
                className="inline-flex h-9 items-center gap-1.5 border border-border-low bg-bg1 px-3 font-mono text-[11px] text-sand-1200 transition-colors hover:border-border-medium hover:bg-sand-100 hover:text-sand-1600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400"
              >
                <span aria-hidden="true" className="text-sm leading-none">
                  𝕏
                </span>
                @WhiteMoonDev
              </a>
              <a
                href="https://www.youtube.com/@whitemoondev"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="White Moon Dev on YouTube"
                className="inline-flex h-9 w-9 items-center justify-center border border-border-low bg-bg1 text-sand-1200 transition-colors hover:border-border-medium hover:bg-sand-100 hover:text-sand-1600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400"
              >
                <Youtube className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map((col) => (
              <div key={col.title}>
                <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-sand-1100">{col.title}</h3>
                <ul className="mt-3 space-y-1">
                  {col.links.map((link) => (
                    <li key={link.to}>
                      {link.external ? (
                        <a href={link.to} target="_blank" rel="noopener noreferrer" className={linkClass}>
                          {link.label}
                          <span className="ml-1 text-sand-1000" aria-hidden="true">
                            ↗
                          </span>
                        </a>
                      ) : (
                        <Link to={link.to} className={linkClass}>
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col gap-3 border-t border-border-low px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-sand-1100">
            &copy; {currentYear} Orquestra · MIT License · Built on Cloudflare
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] text-sand-1100">
            <span>api.orquestra.dev</span>
            <span>/mcp</span>
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="inline-flex h-8 items-center gap-1.5 border border-border-low bg-bg1 px-3 text-xs font-medium text-sand-1200 transition-colors hover:border-border-medium hover:bg-sand-100 hover:text-sand-1600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400"
            >
              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              Back to top
            </button>
          </div>
        </div>
      </div>
    </footer>
  )
}
