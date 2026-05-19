import { Github } from 'lucide-react'
import { Logo } from '@/ui/Logo'

export default function Footer(): JSX.Element {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl border-x border-t border-border-low">
        <div className="grid gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <Logo markClassName="h-8 w-8" />
            <p className="mt-4 max-w-sm text-sm leading-6 text-sand-1200">
              Public interfaces for private execution. Orquestra turns Solana program IDLs into
              API, docs, MCP tools, and transaction builders.
            </p>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.1em] text-sand-1100">
              &copy; {currentYear} Orquestra · MIT License
            </p>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="https://github.com/berkayoztunc/orquestra"
              className="inline-flex min-h-10 items-center gap-2 border border-border-low bg-bg1 px-4 text-sm font-medium text-sand-1200 transition-colors hover:border-border-medium hover:bg-sand-100 hover:text-sand-1600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400"
            >
              <Github className="h-4 w-4" aria-hidden="true" />
              GitHub
            </a>
            <a
              href="https://x.com/WhiteMoonDev"
              className="inline-flex min-h-10 items-center border border-border-low bg-bg1 px-4 text-sm font-medium text-sand-1200 transition-colors hover:border-border-medium hover:bg-sand-100 hover:text-sand-1600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400"
            >
              X
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
