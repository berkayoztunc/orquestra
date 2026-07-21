import type { ReactNode } from 'react'
import { NavLink, useLocation, Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from './cn'

const docsNav = [
  { href: '/docs/api', label: 'API', section: 'Reference' },
  { href: '/docs/mcp', label: 'MCP Server', section: 'Reference' },
  { href: '/docs/cli', label: 'CLI', section: 'Reference' },
  { href: '/docs/packages', label: 'Published Packages', section: 'Reference' },
  { href: '/docs/sign-and-send', label: 'Sign & Send', section: 'Guides' },
  { href: '/docs/flow-engine', label: 'Flow Engine', section: 'Guides' },
]

type TocItem = { id: string; label: string }

type DocsLayoutProps = {
  title: string
  description: string
  section?: string
  product?: string
  children: ReactNode
  toc?: (TocItem | string)[]
}

function normalizeToc(toc: DocsLayoutProps['toc']): TocItem[] {
  if (!toc) return []
  return toc.map((item) =>
    typeof item === 'string'
      ? { id: item.toLowerCase().replace(/\s+/g, '-'), label: item }
      : item,
  )
}

export function DocsLayout({
  title,
  description,
  product = 'orquestra',
  children,
  toc,
}: DocsLayoutProps): JSX.Element {
  const location = useLocation()
  const tocItems = normalizeToc(toc)
  const sections = Array.from(new Set(docsNav.map((n) => n.section)))

  return (
    <div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
      {/* Sidebar */}
      <aside className="border-b border-border-low bg-bg1 md:sticky md:top-0 md:h-screen md:self-start md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="p-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 px-2 py-1.5 text-sm text-sand-1200 transition-colors hover:bg-sand-100 hover:text-sand-1600"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            orquestra
          </Link>

          <div className="mt-5 flex w-full items-center justify-between gap-2 border border-border-low bg-gradient-to-b from-sand-100 to-sand-100/50 px-3 py-2 text-sm">
            <span className="font-mono text-sand-1500">{product}</span>
            <ChevronRight className="h-3.5 w-3.5 text-sand-1100" aria-hidden="true" />
          </div>

          <nav className="mt-6 space-y-5" aria-label="Documentation">
            {sections.map((sec) => (
              <div key={sec}>
                <p className="px-2 font-mono text-[11px] uppercase tracking-[0.14em] text-sand-1100">
                  {sec}
                </p>
                <div className="mt-2 space-y-0.5">
                  {docsNav
                    .filter((n) => n.section === sec)
                    .map((item) => (
                      <NavLink
                        key={item.href}
                        to={item.href}
                        className={({ isActive }) =>
                          cn(
                            'block px-2 py-1.5 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400',
                            isActive
                              ? 'bg-sand-1600 text-bg1'
                              : 'text-sand-1200 hover:bg-sand-100 hover:text-sand-1600',
                          )
                        }
                      >
                        {item.label}
                      </NavLink>
                    ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <main className="min-w-0 bg-cream">
        <div className="px-8 py-10 sm:px-12 sm:py-14">
          <div className="flex gap-10">
            <article className="min-w-0 flex-1">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-sand-1100">
                {location.pathname}
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-sand-1200 sm:text-4xl">
                {title}
              </h1>
              <p className="mb-10 mt-6 border-l-4 border-border-low pl-4 text-lg leading-relaxed text-sand-1200">
                {description}
              </p>

              <div
                className="docs-content max-w-none
                  [&_h2]:mt-12 [&_h2]:mb-4 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-sand-1600
                  [&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-sand-1600
                  [&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-sand-1600
                  [&_p]:mb-4 [&_p]:leading-relaxed [&_p]:text-sand-1200
                  [&_strong]:font-semibold [&_strong]:text-sand-1400
                  [&_em]:text-sand-1300
                  [&_a]:text-sand-1600 [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:no-underline
                  [&_ul]:my-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ul]:text-sand-1200
                  [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_ol]:text-sand-1200
                  [&_li]:leading-relaxed
                  [&_code]: [&_code]:border [&_code]:border-border-low [&_code]:bg-sand-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-sand-1500
                  [&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]: [&_pre]:border [&_pre]:border-border-low [&_pre]:bg-sand-50 [&_pre]:p-4
                  [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0
                  [&_blockquote]:my-5 [&_blockquote]:border-l-4 [&_blockquote]:border-border-medium [&_blockquote]:pl-4 [&_blockquote]:text-sand-1200
                  [&_hr]:my-8 [&_hr]:border-border-low
                  [&_table]:my-5 [&_table]:w-full [&_table]:border [&_table]:border-border-low
                  [&_th]:border [&_th]:border-border-low [&_th]:bg-sand-100 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold [&_th]:text-sand-1500
                  [&_td]:border [&_td]:border-border-low [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm [&_td]:text-sand-1200"
              >
                {children}
              </div>
            </article>

            {tocItems.length > 0 ? (
              <aside className="hidden w-44 flex-shrink-0 xl:block">
                <div className="sticky top-24">
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-sand-1100">
                    On this page
                  </p>
                  <ul className="mt-3 space-y-2">
                    {tocItems.map((item) => (
                      <li key={item.id}>
                        <a
                          href={`#${item.id}`}
                          className="block text-sm text-sand-1200 transition-colors hover:text-sand-1600"
                        >
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  )
}
