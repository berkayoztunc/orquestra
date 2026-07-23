import { useEffect, useMemo, useState } from 'react'
import { Search, X, Workflow } from 'lucide-react'
import { listFlows, type FlowSummary } from '../api/client'
import { Badge } from '@/ui/Badge'
import { Card } from '@/ui/Card'
import { Input } from '@/ui/Input'
import { Button } from '@/ui/Button'
import { PageShell } from '@/ui/PageShell'
import { cn } from '@/ui/cn'

const TIER_TONE: Record<string, 'ink' | 'stone' | 'default'> = {
  intent: 'ink',
  composed: 'stone',
  instruction: 'default',
}

export default function Flows(): JSX.Element {
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [intentFilter, setIntentFilter] = useState<string>('')
  const [protocolFilter, setProtocolFilter] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    listFlows()
      .then((result) => {
        if (!cancelled) setFlows(result)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the flow catalog. Try again shortly.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const intents = useMemo(() => Array.from(new Set(flows.map((f) => f.intent))).sort(), [flows])
  const protocols = useMemo(
    () => Array.from(new Set(flows.map((f) => f.protocol).filter((p): p is string => Boolean(p)))).sort(),
    [flows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return flows.filter((flow) => {
      if (intentFilter && flow.intent !== intentFilter) return false
      if (protocolFilter && flow.protocol !== protocolFilter) return false
      if (!q) return true
      const haystack = [flow.slug, flow.meta.name, flow.meta.description, flow.intent, flow.protocol]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [flows, search, intentFilter, protocolFilter])

  const activeFilters = (intentFilter ? 1 : 0) + (protocolFilter ? 1 : 0)

  const selectClassName = cn(
    'border border-line bg-paper px-3 py-2 text-xs font-medium text-ink transition-colors duration-150',
    'focus:border-taupe focus:outline-none focus:ring-2 focus:ring-taupe/25',
  )

  return (
    <div className="px-6 py-10 sm:px-8 sm:py-12">
      <PageShell
        eyebrow="Flow Engine"
        title="Flows"
        description={
          <>
            Published Orquestra Flow Engine recipes — minimal-input, IDL-driven transaction builders. See{' '}
            <a href="/docs/flow-engine" className="text-ink underline underline-offset-4 hover:no-underline">
              the docs
            </a>{' '}
            for how to author and run one via MCP.
          </>
        }
        className="space-y-6"
      >
        {/* Search + filters */}
        <Card tone="sand" className="space-y-3 p-4">
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
              <Search className="h-4 w-4 text-sand-1000" aria-hidden="true" />
            </div>
            <Input
              type="text"
              placeholder="Search by name, description, intent, or protocol…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-10"
            />
            {search ? (
              <button
                onClick={() => setSearch('')}
                className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-sand-1000 transition-colors hover:text-sand-1600"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {(intents.length > 0 || protocols.length > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {intents.length > 0 && (
                <select value={intentFilter} onChange={(e) => setIntentFilter(e.target.value)} className={selectClassName}>
                  <option value="">All intents</option>
                  {intents.map((intent) => (
                    <option key={intent} value={intent}>
                      {intent}
                    </option>
                  ))}
                </select>
              )}
              {protocols.length > 0 && (
                <select value={protocolFilter} onChange={(e) => setProtocolFilter(e.target.value)} className={selectClassName}>
                  <option value="">All protocols</option>
                  {protocols.map((protocol) => (
                    <option key={protocol} value={protocol}>
                      {protocol}
                    </option>
                  ))}
                </select>
              )}
              {activeFilters > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIntentFilter('')
                    setProtocolFilter('')
                  }}
                >
                  Clear filters
                </Button>
              )}
              {!isLoading && (
                <span className="ml-auto text-xs tabular-nums text-sand-900">
                  {filtered.length.toLocaleString()} flow{filtered.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </Card>

        {/* Results */}
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card-static animate-pulse space-y-3 p-5">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 flex-shrink-0 bg-sand-200" />
                  <div className="h-5 w-36 bg-sand-200" />
                </div>
                <div className="h-3.5 w-full bg-sand-200" />
                <div className="h-3.5 w-2/3 bg-sand-200" />
              </div>
            ))}
          </div>
        ) : error ? (
          <Card className="p-12 text-center">
            <p className="text-lg text-sand-1400">{error}</p>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="mb-2 text-lg text-sand-1400">
              {search || activeFilters > 0 ? 'No flows found' : 'No published flows yet'}
            </p>
            <p className="text-sand-1100">
              {search || activeFilters > 0
                ? 'Try adjusting your search or filters'
                : 'Flows are authored and published via the Flow Engine MCP server — see the docs to get started.'}
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((flow) => (
              <Card key={flow.slug} interactive className="flex flex-col gap-3 p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center border border-border-low bg-sand-100 text-sand-1400">
                    <Workflow className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-sand-1600">{flow.meta.name}</h3>
                    <p className="truncate font-mono text-xs text-sand-1000">{flow.slug}</p>
                  </div>
                </div>

                <p className="line-clamp-2 text-sm leading-relaxed text-sand-1200">
                  {flow.meta.description || 'No description provided for this flow.'}
                </p>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="ink">{flow.intent}</Badge>
                  {flow.protocol ? <Badge>{flow.protocol}</Badge> : null}
                  <Badge tone={TIER_TONE[flow.tier] ?? 'default'}>{flow.tier}</Badge>
                </div>

                <div className="mt-auto flex items-center justify-between border-t border-border-low pt-3 text-xs text-sand-900">
                  <span>
                    {Object.keys(flow.inputs).length} input{Object.keys(flow.inputs).length !== 1 ? 's' : ''}
                  </span>
                  <span className="font-mono">{Object.keys(flow.inputs).join(', ') || '—'}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </PageShell>
    </div>
  )
}
