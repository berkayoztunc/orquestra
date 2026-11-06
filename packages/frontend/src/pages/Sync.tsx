import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, ChevronRight, AlertCircle, RefreshCw } from 'lucide-react'
import {
  getCandidateStats,
  getDiscoveryFeed,
  getPipelineHealth,
  getPublicStats,
  getScanMetadata,
  getSyncHistory,
  getSyncStatus,
  getVerifiedBuildTotal,
  type CandidateStats,
  type DiscoveredProgram,
  type PipelineHealth,
  type PipelineHealthCheck,
  type PublicStats,
  type ScanMetadata,
  type SyncRun,
  type SyncUpdate,
  type VerifiedBuildTotal,
} from '@/api/client'

// ── Helpers ───────────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat('en-US')
const fmt = (n: number | null | undefined): string => nf.format(n ?? 0)

/** The API stores "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker; ISO strings pass through. */
function parseUtc(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) || value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
}

function relative(value: string | null | undefined): string {
  if (!value) return '—'
  const diff = Date.now() - parseUtc(value).getTime()
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0) return `${mins}m ago`
  return 'just now'
}

function absolute(value: string): string {
  return parseUtc(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function duration(startIso: string, endIso: string | null): string {
  if (!endIso) return 'Running…'
  const secs = Math.round((parseUtc(endIso).getTime() - parseUtc(startIso).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function pct(n: number, total: number, digits = 1): string {
  if (!total) return '0%'
  const v = (n / total) * 100
  return `${v < 0.1 && v > 0 ? '<0.1' : v.toFixed(digits)}%`
}

const TRIGGER_LABEL: Record<string, string> = { cron: 'scheduled', manual: 'manual', import: 'queue import' }

type Tone = 'ok' | 'warn' | 'bad' | 'idle'
const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-[#b75000]',
  bad: 'bg-[#b71c00] motion-safe:animate-pulse',
  idle: 'bg-sand-700',
}
const HEALTH_BADGE = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
  degraded: 'border-[#b75000]/30 bg-[#b75000]/10 text-[#b75000]',
  critical: 'border-[#b71c00]/30 bg-[#b71c00]/10 text-[#b71c00]',
} as const

function toneOf(check?: PipelineHealthCheck): Tone {
  if (!check) return 'idle'
  if (check.ok) return 'ok'
  return check.severity === 'critical' ? 'bad' : 'warn'
}

// ── UI pieces ────────────────────────────────────────────────────────────────

function Panel({ title, eyebrow, right, children }: { title: string; eyebrow?: string; right?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section className="border border-border-low bg-bg1 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          {eyebrow && <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-sand-1000">{eyebrow}</p>}
          <h2 className="mt-0.5 text-base font-semibold text-sand-1600">{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

function Skeleton({ className = '' }: { className?: string }): JSX.Element {
  return <div className={`bg-sand-200 motion-safe:animate-pulse ${className}`} />
}

function Empty({ title, desc }: { title: string; desc?: string }): JSX.Element {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center border border-dashed border-border-low bg-sand-50 px-4 py-6 text-center">
      <p className="text-sm font-semibold text-sand-1600">{title}</p>
      {desc && <p className="mt-1 max-w-sm text-xs leading-5 text-sand-1200">{desc}</p>}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="border border-border-low bg-sand-50 px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-sand-1000">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-sand-1600">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-sand-1100">{sub}</p>}
    </div>
  )
}

interface Segment {
  label: string
  value: number
  className: string
}

/** One horizontal bar split into labelled segments, with a legend underneath. */
function StackedBar({ segments, total }: { segments: Segment[]; total: number }): JSX.Element {
  return (
    <div>
      <div className="flex h-3 overflow-hidden bg-sand-200" role="img" aria-label={segments.map((s) => `${s.label} ${fmt(s.value)}`).join(', ')}>
        {segments.map((s) =>
          s.value > 0 ? (
            <div key={s.label} className={s.className} style={{ width: `${Math.max(0.6, (s.value / (total || 1)) * 100)}%` }} title={`${s.label}: ${fmt(s.value)}`} />
          ) : null,
        )}
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-2 text-sand-1300">
              <span className={`inline-block size-2.5 ${s.className}`} />
              {s.label}
            </span>
            <span className="font-mono text-sand-1200">
              {fmt(s.value)} <span className="text-sand-1000">· {pct(s.value, total)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface StageProps {
  step: number
  title: string
  schedule: string
  tone: Tone
  metric: string
  caption: string
  detail?: string
}

function Stage({ step, title, schedule, tone, metric, caption, detail }: StageProps): JSX.Element {
  return (
    <li className="relative flex min-w-0 flex-1 flex-col border border-border-low bg-bg1 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex size-6 items-center justify-center bg-sand-1600 font-mono text-[11px] text-sand-50">{step}</span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-sand-1100">
          <span className={`inline-block size-2 rounded-full ${TONE_DOT[tone]}`} aria-hidden="true" />
          {tone === 'ok' ? 'healthy' : tone === 'idle' ? 'no signal' : tone === 'warn' ? 'degraded' : 'critical'}
        </span>
      </div>
      <h3 className="mt-3 text-sm font-semibold text-sand-1600">{title}</h3>
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-sand-1000">{schedule}</p>
      <p className="mt-3 font-mono text-2xl font-semibold tabular-nums text-sand-1600">{metric}</p>
      <p className="text-xs text-sand-1200">{caption}</p>
      {detail && <p className="mt-2 border-t border-border-low pt-2 text-[11px] leading-4 text-sand-1100">{detail}</p>}
    </li>
  )
}

function Connector(): JSX.Element {
  return (
    <li aria-hidden="true" className="flex items-center justify-center py-1 text-sand-1000 lg:px-1 lg:py-0">
      <ChevronRight className="hidden size-4 lg:block" />
      <ChevronRight className="size-4 rotate-90 lg:hidden" />
    </li>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Sync(): JSX.Element {
  const [run, setRun] = useState<SyncRun | null>(null)
  const [updatedToday, setUpdatedToday] = useState(0)
  const [verifiedCount, setVerifiedCount] = useState(0)
  const [publicStats, setPublicStats] = useState<PublicStats | null>(null)
  const [candidates, setCandidates] = useState<CandidateStats | null>(null)
  const [scanMeta, setScanMeta] = useState<ScanMetadata | null>(null)
  const [verifiedTotal, setVerifiedTotal] = useState<VerifiedBuildTotal | null>(null)
  const [health, setHealth] = useState<PipelineHealth | null>(null)
  const [recent, setRecent] = useState<SyncUpdate[]>([])
  const [discovered, setDiscovered] = useState<DiscoveredProgram[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)

  const fetchAll = useCallback(async () => {
    // Every source is independent: one failing endpoint must not blank the whole page.
    const [status, stats, cand, scan, total, hl, hist, disc] = await Promise.allSettled([
      getSyncStatus(),
      getPublicStats(),
      getCandidateStats(),
      getScanMetadata(),
      getVerifiedBuildTotal(),
      getPipelineHealth(),
      getSyncHistory({ limit: 8 }),
      getDiscoveryFeed({ days: 7, limit: 8 }),
    ])
    if (status.status === 'fulfilled') {
      setRun(status.value.run)
      setUpdatedToday(status.value.updated_today ?? 0)
      setVerifiedCount(status.value.verified_count ?? 0)
      setError(null)
    } else {
      const e: any = status.reason
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load sync status')
    }
    if (stats.status === 'fulfilled') setPublicStats(stats.value)
    if (cand.status === 'fulfilled') setCandidates(cand.value.stats)
    if (scan.status === 'fulfilled') setScanMeta(scan.value.metadata)
    if (total.status === 'fulfilled') setVerifiedTotal(total.value)
    if (hl.status === 'fulfilled') setHealth(hl.value)
    if (hist.status === 'fulfilled') setRecent(hist.value.updates)
    if (disc.status === 'fulfilled') setDiscovered(disc.value.programs)
    setRefreshedAt(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 30_000)
    return () => clearInterval(interval)
  }, [fetchAll])

  const check = useMemo(() => {
    const map = new Map<string, PipelineHealthCheck>()
    for (const c of health?.checks ?? []) map.set(c.name, c)
    return (name: string) => map.get(name)
  }, [health])

  const queueTone: Tone = (() => {
    const a = toneOf(check('import_throughput'))
    const b = toneOf(check('dead_letter_size'))
    if (a === 'bad' || b === 'bad') return 'bad'
    if (a === 'warn' || b === 'warn') return 'warn'
    return a === 'idle' ? 'idle' : 'ok'
  })()

  const runChecked = run?.total_checked ?? 0
  const runLabel = run ? (TRIGGER_LABEL[run.trigger] ?? run.trigger) : ''
  const runStatusText = run
    ? run.status === 'running'
      ? `Running — started ${relative(run.started_at)}`
      : run.status === 'partial'
        ? `Partial run ${relative(run.completed_at)} — resumes from its checkpoint`
        : `Last run ${relative(run.completed_at)}`
    : loading
      ? 'Loading…'
      : 'No sync runs recorded yet'

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 px-6 py-6 sm:px-8 sm:py-8">
      {/* Header */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="mb-2 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-sand-1100">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Data pipeline
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-sand-1600 md:text-3xl">Sync pipeline</h1>
          <p className="mt-2 text-sm leading-6 text-sand-1200">
            How Orquestra keeps its catalog fresh: it scans Solana for programs, queues the ones with an IDL, re-checks every IDL for changes, and
            tracks verified builds. An hourly health checker repairs stalls on its own.
          </p>
          <p className="mt-2 text-xs text-sand-1100">{runStatusText}</p>
        </div>

        <div className="flex items-center gap-3">
          {health && (
            <span className={`inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] ${HEALTH_BADGE[health.status]}`}>
              {health.status === 'ok' ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
              {health.status === 'ok' ? 'All systems healthy' : health.status}
            </span>
          )}
          {refreshedAt && (
            <span className="hidden font-mono text-[11px] text-sand-1000 sm:inline">
              Refreshed {refreshedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} · every 30s
            </span>
          )}
        </div>
      </section>

      {error && (
        <div role="alert" className="border border-[#b75000]/20 bg-[#b75000]/5 p-3 text-sm">
          <p className="font-semibold text-[#b75000]">Something failed to load</p>
          <p className="mt-1 text-[#b75000]/80">{error}</p>
        </div>
      )}

      {/* Pipeline flow */}
      <section aria-label="Pipeline stages">
        {loading ? (
          <div className="grid gap-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-44" />
            ))}
          </div>
        ) : (
          <ol className="flex flex-col lg:flex-row lg:items-stretch">
            <Stage
              step={1}
              title="Chain scan"
              schedule="daily · 01:00 UTC"
              tone={toneOf(check('chain_discovery_freshness'))}
              metric={scanMeta ? relative(scanMeta.scanned_at) : '—'}
              caption="last full scan"
              detail={scanMeta ? `${fmt(scanMeta.programs_found)} programs found · ${fmt(scanMeta.queued)} queued` : 'No scan recorded yet'}
            />
            <Connector />
            <Stage
              step={2}
              title="Verified discovery"
              schedule="daily · 01:00 UTC"
              tone={toneOf(check('discovery_freshness'))}
              metric={fmt(verifiedTotal?.total)}
              caption="verified builds live (OSEC)"
              detail={check('discovery_freshness')?.detail}
            />
            <Connector />
            <Stage
              step={3}
              title="Import queue"
              schedule="continuous"
              tone={queueTone}
              metric={fmt(candidates?.pending)}
              caption="pending candidates"
              detail={candidates ? `${fmt(candidates.total)} program IDs tracked in total` : undefined}
            />
            <Connector />
            <Stage
              step={4}
              title="IDL sync"
              schedule="every 6 hours"
              tone={toneOf(check('stuck_sync_runs'))}
              metric={fmt(updatedToday)}
              caption="IDL changes today"
              detail={run ? `${runStatusText}` : undefined}
            />
            <Connector />
            <Stage
              step={5}
              title="Live catalog"
              schedule="serves API + MCP"
              tone={publicStats ? 'ok' : 'idle'}
              metric={fmt(publicStats?.total_projects)}
              caption="public programs indexed"
              detail={`${fmt(verifiedCount)} with verified builds`}
            />
          </ol>
        )}
      </section>

      {/* Health + queue */}
      <section className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
        <Panel
          eyebrow="Smooth checker"
          title="Pipeline health"
          right={health && <span className="font-mono text-[11px] text-sand-1000">checked {relative(health.checkedAt)}{health.cached ? ' · cached' : ''} · auto-repair hourly at :45</span>}
        >
          {loading ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : health ? (
            <>
              <ul className="grid gap-2 sm:grid-cols-2">
                {health.checks.map((c) => (
                  <li key={c.name} className={`border px-3 py-2.5 ${c.ok ? 'border-border-low bg-sand-50' : 'border-[#b75000]/25 bg-[#b75000]/5'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-sand-1400">
                        <span className={`inline-block size-2 rounded-full ${TONE_DOT[toneOf(c)]}`} aria-hidden="true" />
                        {c.name.replace(/_/g, ' ')}
                      </p>
                      <span className={`font-mono text-[10px] font-bold uppercase ${c.ok ? 'text-sand-1000' : 'text-[#b75000]'}`}>{c.ok ? 'pass' : 'fail'}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-sand-1200" title={c.detail}>
                      {c.detail}
                    </p>
                  </li>
                ))}
              </ul>
              {health.remediations.length > 0 && (
                <div className="mt-3 border border-border-low bg-sand-50 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-sand-1400">Repairs applied</p>
                  <ul className="mt-2 space-y-1 text-xs text-sand-1200">
                    {health.remediations.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <Empty title="Health data unavailable" desc="The checker publishes its first report at the next :45 tick." />
          )}
        </Panel>

        <Panel eyebrow="Auto-import" title="Discovery queue">
          {loading ? (
            <Skeleton className="h-40" />
          ) : candidates ? (
            <div className="space-y-4">
              <StackedBar
                total={candidates.total}
                segments={[
                  { label: 'Has IDL', value: candidates.has_idl, className: 'bg-emerald-500' },
                  { label: 'Pending', value: candidates.pending, className: 'bg-[#b75000]' },
                  { label: 'No IDL (rechecked weekly)', value: candidates.no_idl, className: 'bg-sand-600' },
                ]}
              />
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Tracked" value={fmt(candidates.total)} sub="unique program IDs" />
                <Stat label="IDL hit rate" value={pct(candidates.has_idl, candidates.total, 2)} sub="of all tracked programs" />
              </div>
            </div>
          ) : (
            <Empty title="No candidates queued yet" desc="Daily OSEC discovery fills this queue at 01:00 UTC." />
          )}
        </Panel>
      </section>

      {/* Latest run + verified builds */}
      <section className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
        <Panel
          eyebrow="Durable workflow"
          title="Latest run"
          right={run && <span className="border border-border-low bg-sand-100 px-2.5 py-1 font-mono text-[11px] text-sand-1400">{runLabel}</span>}
        >
          {loading ? (
            <Skeleton className="h-40" />
          ) : run ? (
            <div className="space-y-4">
              {runChecked > 0 ? (
                <StackedBar
                  total={runChecked}
                  segments={[
                    { label: 'Updated', value: run.updated_count ?? 0, className: 'bg-emerald-500' },
                    { label: 'Unchanged', value: run.unchanged_count ?? 0, className: 'bg-sand-600' },
                    { label: 'Skipped (no on-chain IDL)', value: run.skipped_count ?? 0, className: 'bg-sand-400' },
                    { label: 'Errors', value: run.error_count ?? 0, className: 'bg-[#b71c00]' },
                  ]}
                />
              ) : (
                <p className="border border-border-low bg-sand-50 px-3 py-2 text-xs leading-5 text-sand-1200">
                  This run only moved candidates through the import queue, so no IDLs were checked. IDL checks appear here when the 6-hourly sync runs.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label="Checked"
                  value={fmt(runChecked)}
                  sub={(run.total_programs ?? 0) > runChecked ? `of ${fmt(run.total_programs)}` : undefined}
                />
                <Stat label="Updated" value={fmt(run.updated_count)} sub="new IDL versions" />
                <Stat label="Errors" value={fmt(run.error_count)} sub={(run.error_count ?? 0) > 0 ? 'check logs' : 'clean'} />
                <Stat label="Duration" value={duration(run.started_at, run.completed_at)} sub="wall clock" />
              </div>
              <p className="font-mono text-[11px] text-sand-1000">
                Started {absolute(run.started_at)}
                {run.completed_at && ` · completed ${absolute(run.completed_at)}`}
              </p>
            </div>
          ) : (
            <Empty title="No sync runs yet" desc="The first sync starts automatically at the next 6-hour tick." />
          )}
        </Panel>

        <Panel eyebrow="OSEC" title="Verified builds">
          {loading ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="space-y-4">
              <StackedBar
                total={verifiedTotal?.total || verifiedCount || 1}
                segments={[
                  { label: 'Imported into Orquestra', value: verifiedCount, className: 'bg-emerald-500' },
                  {
                    label: 'Not imported yet',
                    value: Math.max((verifiedTotal?.total ?? 0) - verifiedCount, 0),
                    className: 'bg-sand-400',
                  },
                ]}
              />
              <div className="grid grid-cols-2 gap-2">
                <Stat label="OSEC live total" value={fmt(verifiedTotal?.total)} sub={verifiedTotal?.fetched_at ? `fetched ${relative(verifiedTotal.fetched_at)}` : 'not fetched yet'} />
                <Stat label="In database" value={fmt(verifiedCount)} sub="verified + imported" />
              </div>
            </div>
          )}
        </Panel>
      </section>

      {/* Activity feeds */}
      <section className="grid gap-3 lg:grid-cols-2">
        <Panel
          eyebrow="Last 7 days"
          title="Recently discovered programs"
          right={<span className="font-mono text-[11px] text-sand-1000">{discovered.length} shown</span>}
        >
          {loading ? (
            <Skeleton className="h-48" />
          ) : discovered.length === 0 ? (
            <Empty title="Nothing new this week" desc="Newly discovered programs with an IDL appear here." />
          ) : (
            <ul className="divide-y divide-border-low">
              {discovered.map((p) => (
                <li key={p.id}>
                  <Link to={`/project/${p.program_id}`} className="group flex items-center gap-3 py-2.5 transition-colors hover:bg-sand-50">
                    <span className="flex size-8 shrink-0 items-center justify-center border border-border-low bg-sand-100 text-xs font-semibold text-sand-1500">
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-sand-1600">{p.name}</p>
                      <p className="truncate font-mono text-[11px] text-sand-1000">{p.program_id}</p>
                    </div>
                    <time className="shrink-0 font-mono text-[11px] text-sand-1100" title={absolute(p.created_at)}>
                      {relative(p.created_at)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          eyebrow="Latest changes"
          title="Recent IDL updates"
          right={
            <Link to="/updates" className="inline-flex items-center gap-1 font-mono text-[11px] text-sand-1200 underline-offset-4 hover:text-sand-1600 hover:underline">
              All updates <ArrowRight className="size-3" />
            </Link>
          }
        >
          {loading ? (
            <Skeleton className="h-48" />
          ) : recent.length === 0 ? (
            <Empty title="No IDL updates yet" desc="Changes detected by the sync show up here." />
          ) : (
            <ul className="divide-y divide-border-low">
              {recent.map((u) => (
                <li key={u.id}>
                  <Link to={`/project/${u.program_id}`} className="flex items-center gap-3 py-2.5 transition-colors hover:bg-sand-50">
                    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden border border-border-low bg-sand-100 text-xs font-semibold text-sand-1500">
                      {(u as SyncUpdate & { icon_url?: string | null }).icon_url ? (
                        <img src={(u as SyncUpdate & { icon_url?: string | null }).icon_url as string} alt="" className="h-full w-full object-contain p-0.5" />
                      ) : (
                        (u.program_name || u.project_name || '?').charAt(0).toUpperCase()
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-sand-1600">{u.program_name || u.project_name || u.program_id}</p>
                      <p className="font-mono text-[11px] text-sand-1000">
                        {u.old_version !== null ? `v${u.old_version}` : 'new'} → <span className="text-sand-1500">v{u.new_version}</span>
                      </p>
                    </div>
                    <time className="shrink-0 font-mono text-[11px] text-sand-1100" title={absolute(u.detected_at)}>
                      {relative(u.detected_at)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </div>
  )
}
