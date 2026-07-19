import { useEffect, useState, useCallback } from 'react'
import {
  getSyncStatus,
  getCandidateStats,
  getScanMetadata,
  getVerifiedBuildTotal,
  getPublicStats,
  getPipelineHealth,
  type SyncRun,
  type CandidateStats,
  type ScanMetadata,
  type VerifiedBuildTotal,
  type PublicStats,
  type PipelineHealth,
} from '@/api/client'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0) return `${mins}m ago`
  return 'just now'
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return 'Running…'
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remSecs = secs % 60
  return `${mins}m ${remSecs}s`
}

const HEALTH_TONES = {
  ok: { text: 'text-sand-1600', badge: 'border-border-low bg-sand-100 text-sand-1500', dot: 'bg-sand-1600' },
  degraded: { text: 'text-[#b75000]', badge: 'border-[#b75000]/20 bg-[#b75000]/5 text-[#b75000]', dot: 'bg-[#b75000]' },
  critical: { text: 'text-[#b71c00]', badge: 'border-[#b71c00]/20 bg-[#b71c00]/5 text-[#b71c00]', dot: 'bg-[#b71c00] motion-safe:animate-pulse' },
} as const

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string | number
  sub?: string
}) {
  return (
    <div className="border border-border-low bg-bg1 p-5">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-sand-1100">{label}</p>
      <p className="mt-2 text-2xl font-black tabular-nums tracking-tight text-sand-1600">{value}</p>
      {sub && <p className="mt-1 text-sm text-sand-1200">{sub}</p>}
    </div>
  )
}

function SectionHeader({ eyebrow, title, badge }: { eyebrow: string; title: string; badge?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-sand-1500">{eyebrow}</p>
        <h2 className="mt-1 text-xl font-bold text-sand-1600">{title}</h2>
      </div>
      {badge}
    </div>
  )
}

function EmptyState({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center border border-dashed border-border-low bg-sand-50 px-4 py-8 text-center">
      <p className="font-semibold text-sand-1600">{title}</p>
      {desc && <p className="mt-1 max-w-sm text-sm leading-6 text-sand-1200">{desc}</p>}
    </div>
  )
}

function SkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border border-border-low bg-bg1 p-5">
          <div className="h-3 w-24 bg-sand-200 motion-safe:animate-pulse" />
          <div className="mt-3 h-8 w-20 bg-sand-200 motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Sync(): JSX.Element {
  const [run, setRun] = useState<SyncRun | null>(null)
  const [updatedToday, setUpdatedToday] = useState(0)
  const [verifiedCount, setVerifiedCount] = useState(0)
  const [publicStats, setPublicStats] = useState<PublicStats | null>(null)
  const [candidates, setCandidates] = useState<CandidateStats | null>(null)
  const [scanMeta, setScanMeta] = useState<ScanMetadata | null>(null)
  const [verifiedBuildTotal, setVerifiedBuildTotal] = useState<VerifiedBuildTotal | null>(null)
  const [health, setHealth] = useState<PipelineHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const statusData = await getSyncStatus()
      setRun(statusData.run)
      setUpdatedToday(statusData.updated_today ?? 0)
      setVerifiedCount(statusData.verified_count ?? 0)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? 'Failed to load sync status')
    }

    try {
      const stats = await getPublicStats()
      setPublicStats(stats)
    } catch {
      // non-fatal
    }

    try {
      const candidateData = await getCandidateStats()
      setCandidates(candidateData.stats)
    } catch {
      // program_candidates table may not exist yet
    }

    try {
      const scanData = await getScanMetadata()
      setScanMeta(scanData.metadata)
    } catch {
      // non-fatal
    }

    try {
      const totalData = await getVerifiedBuildTotal()
      setVerifiedBuildTotal(totalData)
    } catch {
      // non-fatal
    }

    try {
      const healthData = await getPipelineHealth()
      setHealth(healthData)
    } catch {
      // non-fatal
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 30_000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  // ── Render ────────────────────────────────────────────────────────────────

  const syncStatusText = run
    ? run.status === 'running'
      ? `Sync running — started ${formatRelative(run.started_at)}`
      : run.status === 'partial'
        ? `Partial run ${formatRelative(run.completed_at!)} — resumed via checkpoint`
        : `Last sync ${formatRelative(run.completed_at!)}`
    : loading ? 'Loading…' : 'No sync runs recorded yet'

  const healthTone = HEALTH_TONES[health?.status ?? 'ok']

  return (
    <div className="space-y-8 px-6 py-10 sm:px-8 sm:py-12">

      {/* Header */}
      <section className="max-w-3xl">
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-sand-1600 md:text-5xl">
          Sync pipeline
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-sand-1200 md:text-base">
          IDL sync, verified builds, and the program discovery queue — with an hourly
          health checker that repairs stalls automatically.
        </p>
        <p className="mt-3 text-sm text-sand-1200">{syncStatusText}</p>
      </section>

      {error && (
        <div className="border border-[#b75000]/20 bg-[#b75000]/5 p-4 text-sm">
          <p className="font-semibold text-[#b75000]">Something failed to load</p>
          <p className="mt-1 text-[#b75000]/80">{error}</p>
        </div>
      )}

      {/* ── Pipeline Health ── */}
      <section className="border border-border-low bg-bg1 p-5">
        <SectionHeader
          eyebrow="Smooth checker"
          title="Pipeline health"
          badge={
            health && (
              <span className={`inline-flex w-fit items-center gap-2 border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${healthTone.badge}`}>
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${healthTone.dot}`} aria-hidden="true" />
                {health.status}
              </span>
            )
          }
        />
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 border border-border-low bg-sand-200 motion-safe:animate-pulse" />
            ))}
          </div>
        ) : health ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {health.checks.map((check) => (
                <div
                  key={check.name}
                  className={`border p-3 ${check.ok ? 'border-border-low bg-sand-50' : 'border-[#b75000]/20 bg-[#b75000]/5'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${check.ok ? 'text-sand-1500' : 'text-[#b75000]'}`}>
                      {check.name.replace(/_/g, ' ')}
                    </p>
                    <span className={`text-xs font-bold ${check.ok ? 'text-sand-1100' : 'text-[#b75000]'}`}>
                      {check.ok ? 'pass' : 'fail'}
                    </span>
                  </div>
                  <p className="mt-1.5 truncate text-sm text-sand-1200">{check.detail}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-sand-1100">
              Checked {formatRelative(health.checkedAt)}{health.cached ? ' · cached' : ''} · auto-repair runs hourly at :45
            </p>
            {health.remediations.length > 0 && (
              <div className="mt-3 border border-border-low bg-sand-50 p-3">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-sand-1500">Repairs applied</p>
                <ul className="mt-2 space-y-1 text-sm text-sand-1200">
                  {health.remediations.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <EmptyState title="Health data unavailable" desc="The checker publishes its first report at the next :45 tick." />
        )}
      </section>

      {/* ── Overview ── */}
      <section>
        {loading ? (
          <SkeletonGrid count={4} />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Active programs"
              value={(publicStats?.total_projects ?? 0).toLocaleString()}
              sub="public indexed programs"
            />
            <StatCard
              label="IDL updated today"
              value={updatedToday.toLocaleString()}
              sub={updatedToday > 0 ? 'new versions detected' : 'no changes yet today'}
            />
            <StatCard
              label="Verified in DB"
              value={verifiedCount.toLocaleString()}
              sub="OSEC verified + imported"
            />
            <StatCard
              label="OSEC live total"
              value={(verifiedBuildTotal?.total ?? 0).toLocaleString()}
              sub={verifiedBuildTotal?.fetched_at ? `fetched ${formatRelative(verifiedBuildTotal.fetched_at)}` : 'not fetched yet'}
            />
          </div>
        )}
      </section>

      {/* ── Latest IDL Sync Run ── */}
      <section className="border border-border-low bg-bg1 p-5">
        <SectionHeader
          eyebrow="Durable workflow"
          title="Latest sync run"
          badge={
            run && (
              <span className="w-fit border border-border-low bg-sand-100 px-3 py-1 text-xs font-medium text-sand-1500">
                {run.trigger === 'manual' ? 'manual trigger' : run.trigger}
              </span>
            )
          }
        />
        {loading ? (
          <SkeletonGrid count={4} />
        ) : run ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard
                label="Checked"
                value={`${(run.total_checked ?? 0).toLocaleString()}${
                  (run.total_programs ?? 0) > 0 && run.total_programs !== run.total_checked
                    ? ` / ${(run.total_programs ?? 0).toLocaleString()}`
                    : ''
                }`}
                sub={run.status === 'partial' ? 'partial — resumes next run' : 'this run'}
              />
              <StatCard label="Updated" value={(run.updated_count ?? 0).toLocaleString()} sub="new IDL versions" />
              <StatCard label="Unchanged" value={(run.unchanged_count ?? 0).toLocaleString()} sub="no changes" />
              <StatCard label="Skipped" value={(run.skipped_count ?? 0).toLocaleString()} sub="no on-chain IDL" />
              <StatCard
                label="Errors"
                value={(run.error_count ?? 0).toLocaleString()}
                sub={(run.error_count ?? 0) > 0 ? 'check logs' : 'clean run'}
              />
              <StatCard label="Duration" value={formatDuration(run.started_at, run.completed_at)} sub="wall clock" />
            </div>
            <p className="mt-4 text-xs text-sand-1100">
              Started {formatDate(run.started_at)}
              {run.completed_at && ` · completed ${formatDate(run.completed_at)}`}
            </p>
          </>
        ) : (
          <EmptyState
            title="No sync runs yet"
            desc="The first sync starts automatically at the next 6-hour tick."
          />
        )}
      </section>

      {/* ── Discovery Queue ── */}
      <section className="border border-border-low bg-bg1 p-5">
        <SectionHeader eyebrow="Auto-import" title="Discovery queue" />
        {loading ? (
          <SkeletonGrid count={4} />
        ) : candidates ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Total in queue" value={(candidates.total ?? 0).toLocaleString()} sub="unique program IDs" />
            <StatCard label="Pending" value={(candidates.pending ?? 0).toLocaleString()} sub="awaiting import" />
            <StatCard label="Has IDL" value={(candidates.has_idl ?? 0).toLocaleString()} sub="verified + imported" />
            <StatCard label="No IDL" value={(candidates.no_idl ?? 0).toLocaleString()} sub="rechecked weekly" />
          </div>
        ) : (
          <EmptyState title="No candidates queued yet" desc="Daily OSEC discovery fills this queue at 01:00 UTC." />
        )}
      </section>

      {/* ── Last Full Chain Scan ── */}
      <section className="border border-border-low bg-bg1 p-5">
        <SectionHeader eyebrow="Chain scan" title="Last full chain scan" />
        {loading ? (
          <SkeletonGrid count={4} />
        ) : scanMeta ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Programs found" value={(scanMeta.programs_found ?? 0).toLocaleString()} sub="total on-chain programs" />
            <StatCard label="Queued" value={(scanMeta.queued ?? 0).toLocaleString()} sub="added to discovery queue" />
            <StatCard label="Skipped" value={(scanMeta.skipped ?? 0).toLocaleString()} sub="invalid program IDs" />
            <StatCard label="Scanned" value={formatRelative(scanMeta.scanned_at)} sub={formatDate(scanMeta.scanned_at)} />
          </div>
        ) : (
          <EmptyState title="No scan data yet" desc="The daily chain scan runs at 1am UTC." />
        )}
      </section>

    </div>
  )
}
