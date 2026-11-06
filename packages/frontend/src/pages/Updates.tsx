import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, GitCommitHorizontal, RefreshCw, Search, Sparkles, X } from 'lucide-react'
import { useProjectsStore } from '../store/projects'

const PAGE_SIZE = 50

interface Update {
  id: string
  project_id: string
  program_id: string
  program_name: string | null
  old_version: number | null
  new_version: number
  old_hash: string | null
  new_hash: string
  detected_at: string
  icon_url?: string | null
}

/** One program's changes within one day, collapsed into a version range. */
interface Entry {
  key: string
  programId: string
  name: string
  iconUrl?: string | null
  fromVersion: number | null
  toVersion: number
  count: number
  oldHash: string | null
  newHash: string
  latest: Date
  isNew: boolean
}

interface DayGroup {
  key: string
  label: string
  date: Date
  entries: Entry[]
  total: number
}

// The API stores "YYYY-MM-DD HH:MM:SS" in UTC without a zone marker.
function parseUtc(value: string): Date {
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
}

function relativeTime(date: Date, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function dayLabel(d: Date): string {
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (dayKey(d) === dayKey(today)) return 'Today'
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

function shortHash(h: string | null): string {
  return h ? h.slice(0, 7) : '—'
}

function groupUpdates(updates: Update[]): DayGroup[] {
  const days = new Map<string, DayGroup>()
  for (const u of updates) {
    const at = parseUtc(u.detected_at)
    const dk = dayKey(at)
    let day = days.get(dk)
    if (!day) {
      day = { key: dk, label: dayLabel(at), date: at, entries: [], total: 0 }
      days.set(dk, day)
    }
    day.total += 1
    // Several bumps of the same program on the same day collapse into one row (v10 → v12 · 2 updates).
    let entry = day.entries.find((e) => e.programId === u.program_id)
    if (!entry) {
      entry = {
        key: `${dk}-${u.program_id}`,
        programId: u.program_id,
        name: u.program_name || u.program_id,
        iconUrl: u.icon_url,
        fromVersion: u.old_version,
        toVersion: u.new_version,
        count: 1,
        oldHash: u.old_hash,
        newHash: u.new_hash,
        latest: at,
        isNew: u.old_version === null,
      }
      day.entries.push(entry)
    } else {
      entry.count += 1
      if (u.new_version > entry.toVersion) {
        entry.toVersion = u.new_version
        entry.newHash = u.new_hash
        if (at > entry.latest) entry.latest = at
      }
      if (u.old_version === null || (entry.fromVersion !== null && u.old_version < entry.fromVersion)) {
        entry.fromVersion = u.old_version
        entry.oldHash = u.old_hash
        entry.isNew = u.old_version === null
      }
    }
  }
  return [...days.values()]
}

function Monogram({ name, iconUrl }: { name: string; iconUrl?: string | null }): JSX.Element {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden border border-border-low bg-sand-100 text-sm font-semibold text-sand-1500">
      {iconUrl ? <img src={iconUrl} alt="" className="h-full w-full object-contain p-1" /> : name.charAt(0).toUpperCase()}
    </div>
  )
}

const steps = [
  { title: 'Daily sync', desc: 'Every indexed program is checked against its IDL on Solana.' },
  { title: 'Change detected', desc: 'A different IDL hash means the program changed its interface.' },
  { title: 'New version stored', desc: 'The IDL is saved as a new version; docs, API and MCP tools follow it.' },
]

export default function Updates(): JSX.Element {
  const { updates, updatesPagination, isLoading, error, loadUpdates } = useProjectsStore()
  const [query, setQuery] = useState('')

  useEffect(() => {
    loadUpdates({ limit: PAGE_SIZE })
  }, [loadUpdates])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return updates as Update[]
    return (updates as Update[]).filter(
      (u) => (u.program_name ?? '').toLowerCase().includes(q) || u.program_id.toLowerCase().includes(q),
    )
  }, [updates, query])

  const groups = useMemo(() => groupUpdates(filtered), [filtered])

  const stats = useMemo(() => {
    const all = updates as Update[]
    const sevenDays = Date.now() - 7 * 86_400_000
    const last7 = all.filter((u) => parseUtc(u.detected_at).getTime() >= sevenDays)
    return {
      total: updatesPagination.total,
      last7: last7.length,
      programs7: new Set(last7.map((u) => u.program_id)).size,
      latest: all[0] ? parseUtc(all[0].detected_at) : null,
    }
  }, [updates, updatesPagination.total])

  const page = updatesPagination.page

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8 sm:px-8 sm:py-10">
      {/* Header: what this page is, how it works, and the headline numbers */}
      <section className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="mb-2 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-sand-1100">
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Changelog
            </p>
            <h1 className="text-balance text-2xl font-semibold tracking-tight text-sand-1600 md:text-3xl">IDL Updates</h1>
            <p className="mt-2 text-sm leading-6 text-sand-1200">
              When a Solana program changes its interface, Orquestra notices. This is the live feed of every new IDL version we detected,
              so you can see which programs just shipped changes and what moved.
            </p>
          </div>

          <dl className="grid grid-cols-3 gap-px overflow-hidden border border-border-low bg-border-low text-center lg:min-w-[360px]">
            {[
              { label: 'Total updates', value: stats.total.toLocaleString() },
              { label: 'Last 7 days', value: stats.last7.toLocaleString(), sub: `${stats.programs7} programs` },
              { label: 'Latest', value: stats.latest ? relativeTime(stats.latest) : '—' },
            ].map((s) => (
              <div key={s.label} className="bg-bg1 px-3 py-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-sand-1000">{s.label}</dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-sand-1600">{s.value}</dd>
                {s.sub && <p className="text-[10px] text-sand-1000">{s.sub}</p>}
              </div>
            ))}
          </dl>
        </div>

        <ol className="grid gap-px overflow-hidden border border-border-low bg-border-low md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3 bg-bg1 p-4">
              <span className="flex size-6 shrink-0 items-center justify-center bg-sand-1600 font-mono text-[11px] text-sand-50">{i + 1}</span>
              <div>
                <p className="text-sm font-semibold text-sand-1600">{step.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-sand-1200">{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sand-1000" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter this page by program name or ID"
          aria-label="Filter updates"
          className="input w-full pl-9 pr-9"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear filter"
            className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center text-sand-1100 hover:text-sand-1600"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="border border-[#b75000]/20 bg-[#b75000]/5 p-3 text-sm text-[#b75000]">
          {error}
        </div>
      )}

      {/* Timeline */}
      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-4 border border-border-low bg-bg1 p-4">
              <div className="size-10 bg-sand-200" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 bg-sand-200" />
                <div className="h-3 w-64 max-w-full bg-sand-100" />
              </div>
              <div className="h-4 w-16 bg-sand-200" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="border border-dashed border-border-low bg-sand-50 px-6 py-12 text-center">
          <Sparkles className="mx-auto mb-3 size-6 text-sand-1000" aria-hidden="true" />
          <p className="font-semibold text-sand-1600">{query ? 'No updates match your filter' : 'No IDL updates detected yet'}</p>
          <p className="mt-1 text-sm text-sand-1200">
            {query ? 'Try a different name, or clear the filter.' : 'The daily sync will log on-chain IDL changes here as they happen.'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((day) => (
            <section key={day.key} aria-label={day.label}>
              <header className="mb-3 flex items-center gap-3 py-1">
                <h2 className="text-sm font-semibold text-sand-1600">{day.label}</h2>
                <span className="border border-border-low bg-sand-100 px-2 py-0.5 font-mono text-[11px] text-sand-1200">
                  {day.total} {day.total === 1 ? 'update' : 'updates'} · {day.entries.length} {day.entries.length === 1 ? 'program' : 'programs'}
                </span>
                <span className="h-px flex-1 bg-border-low" />
              </header>

              <ul className="space-y-2 border-l border-border-low pl-4 sm:pl-6">
                {day.entries.map((e) => (
                  <li key={e.key} className="relative">
                    <span className="absolute -left-[21px] top-5 flex size-2.5 items-center justify-center bg-bg1 sm:-left-[29px]" aria-hidden="true">
                      <span className="size-2 rounded-full border-2 border-sand-1600 bg-bg1" />
                    </span>
                    <div className="group flex flex-col gap-3 border border-border-low bg-bg1 p-4 transition-colors hover:border-border-medium hover:bg-sand-50 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Monogram name={e.name} iconUrl={e.iconUrl} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <Link
                              to={`/project/${e.programId}`}
                              className="truncate text-sm font-semibold text-sand-1600 transition-colors hover:text-primary sm:text-base"
                            >
                              {e.name}
                            </Link>
                            {e.isNew && (
                              <span className="border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-emerald-600">new</span>
                            )}
                            {e.count > 1 && (
                              <span className="border border-border-low bg-sand-100 px-1.5 py-0.5 font-mono text-[10px] text-sand-1200">{e.count} updates</span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-sand-1000" title={e.programId}>
                            {e.programId}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:justify-end">
                        <div className="flex items-center gap-2 font-mono text-sm">
                          <span className="text-sand-1100">{e.fromVersion !== null ? `v${e.fromVersion}` : 'none'}</span>
                          <ArrowRight className="size-3.5 text-sand-1000" aria-hidden="true" />
                          <span className="border border-sand-1500 bg-sand-1600 px-2 py-0.5 font-semibold text-sand-50">v{e.toVersion}</span>
                        </div>
                        <div
                          className="hidden items-center gap-1.5 font-mono text-[11px] text-sand-1000 md:flex"
                          title={`IDL hash ${e.oldHash ?? 'none'} → ${e.newHash}`}
                        >
                          <GitCommitHorizontal className="size-3.5" aria-hidden="true" />
                          {shortHash(e.oldHash)} → {shortHash(e.newHash)}
                        </div>
                        <time
                          dateTime={e.latest.toISOString()}
                          title={e.latest.toLocaleString('en-US')}
                          className="w-16 text-right font-mono text-xs text-sand-1100"
                        >
                          {relativeTime(e.latest)}
                        </time>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Pagination */}
      {updatesPagination.totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-center gap-4">
          <button
            onClick={() => loadUpdates({ page: page - 1, limit: PAGE_SIZE })}
            disabled={page <= 1}
            className="border border-border-low px-4 py-2 text-sm text-sand-1200 transition-colors hover:border-border-medium hover:text-sand-1600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Newer
          </button>
          <span className="font-mono text-xs text-sand-1100">
            Page {page} of {updatesPagination.totalPages}
          </span>
          <button
            onClick={() => loadUpdates({ page: page + 1, limit: PAGE_SIZE })}
            disabled={page >= updatesPagination.totalPages}
            className="border border-border-low px-4 py-2 text-sm text-sand-1200 transition-colors hover:border-border-medium hover:text-sand-1600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Older
          </button>
        </nav>
      )}
    </div>
  )
}
