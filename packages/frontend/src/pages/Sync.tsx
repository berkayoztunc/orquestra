import { useEffect, useState, useCallback } from 'react'
import {
  getSyncStatus,
  getCandidateStats,
  getScanMetadata,
  getVerifiedBuildTotal,
  getPublicStats,
  type SyncRun,
  type CandidateStats,
  type ScanMetadata,
  type VerifiedBuildTotal,
  type PublicStats,
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

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string
  value: string | number
  sub?: string
  highlight?: boolean
}) {
  return (
    <div
      className={`flex flex-col gap-0.5 border px-4 py-3 ${
        highlight
          ? 'border-green-800/40 bg-green-950/20'
          : 'border-border-low bg-bg2'
      }`}
    >
      <span className="text-[10px] font-medium uppercase tracking-wider text-sand-900">{label}</span>
      <span className="text-xl font-bold tabular-nums text-sand-1600">{value}</span>
      {sub && <span className="text-[10px] text-sand-800">{sub}</span>}
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sand-1000">
      {children}
    </h2>
  )
}

function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="border border-border-low px-6 py-8 text-center">
      <p className="font-medium text-sand-1200">{title}</p>
      {sub && <p className="mt-1 text-sm text-sand-900">{sub}</p>}
    </div>
  )
}

function SkeletonGrid({ cols = 4, count }: { cols?: number; count: number }) {
  return (
    <div className={`grid grid-cols-2 gap-3 sm:grid-cols-${cols}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse border border-border-low bg-bg2 px-5 py-4">
          <div className="mb-2 h-3 w-20 rounded bg-sand-200" />
          <div className="h-7 w-16 rounded bg-sand-300" />
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

    setLoading(false)
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 30_000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  // ── Render ────────────────────────────────────────────────────────────────

  const syncStatusDot = run?.status === 'running'
    ? 'animate-pulse bg-yellow-400'
    : run?.status === 'partial'
      ? 'bg-orange-400'
      : run?.completed_at
        ? 'bg-green-500'
        : 'bg-sand-600'

  const syncStatusText = run
    ? run.status === 'running'
      ? `Sync running (started ${formatRelative(run.started_at)})`
      : run.status === 'partial'
        ? `Partial run ${formatRelative(run.completed_at!)} — resumed via checkpoint`
        : `Last sync ${formatRelative(run.completed_at!)}`
    : loading ? 'Loading…' : 'No sync runs recorded yet'

  return (
    <div className="space-y-10 px-6 py-10 sm:px-8 sm:py-12">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-sand-1600">Sync Dashboard</h1>
          <p className="mt-1 text-sand-1000">
            IDL sync · verified builds · discovery queue
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-sand-900">
          <span className={`inline-block h-2 w-2 rounded-full ${syncStatusDot}`} />
          {syncStatusText}
        </div>
      </div>

      {error && (
        <div className="border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* ── Overview ── */}
      <section>
        <SectionHeading>Overview</SectionHeading>
        {loading ? (
          <SkeletonGrid cols={4} count={4} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Active Programs"
              value={(publicStats?.total_projects ?? 0).toLocaleString()}
              sub="public indexed programs"
            />
            <StatCard
              label="IDL Updated Today"
              value={updatedToday.toLocaleString()}
              sub={updatedToday > 0 ? 'new versions detected' : 'no changes yet today'}
            />
            <StatCard
              label="Verified in DB"
              value={verifiedCount.toLocaleString()}
              sub="OSEC verified + imported"
              highlight={verifiedCount > 0}
            />
            <StatCard
              label="OSEC Live Total"
              value={(verifiedBuildTotal?.total ?? 0).toLocaleString()}
              sub={verifiedBuildTotal?.fetched_at ? `fetched ${formatRelative(verifiedBuildTotal.fetched_at)}` : 'not fetched yet'}
            />
          </div>
        )}
      </section>

      {/* ── Latest IDL Sync Run ── */}
      <section>
        <SectionHeading>Latest IDL Sync Run</SectionHeading>
        {loading ? (
          <SkeletonGrid cols={3} count={6} />
        ) : run ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard
                label="Programs Checked"
                value={`${(run.total_checked ?? 0).toLocaleString()}${
                  (run.total_programs ?? 0) > 0 && run.total_programs !== run.total_checked
                    ? ` / ${(run.total_programs ?? 0).toLocaleString()}`
                    : ''
                }`}
                sub={run.status === 'partial' ? 'partial — resumed next run' : 'this run'}
              />
              <StatCard
                label="Updated"
                value={(run.updated_count ?? 0).toLocaleString()}
                sub="new IDL versions"
              />
              <StatCard
                label="Unchanged"
                value={(run.unchanged_count ?? 0).toLocaleString()}
                sub="no changes"
              />
              <StatCard
                label="Skipped"
                value={(run.skipped_count ?? 0).toLocaleString()}
                sub="no on-chain IDL"
              />
              <StatCard
                label="Errors"
                value={(run.error_count ?? 0).toLocaleString()}
                sub={(run.error_count ?? 0) > 0 ? 'check logs' : 'clean run'}
              />
              <StatCard
                label="Duration"
                value={formatDuration(run.started_at, run.completed_at)}
                sub={run.trigger === 'manual' ? 'manual trigger' : 'scheduled cron'}
              />
            </div>
            <p className="mt-2 text-xs text-sand-900">
              Started: {formatDate(run.started_at)}
              {run.completed_at && ` · Completed: ${formatDate(run.completed_at)}`}
            </p>
          </>
        ) : (
          <EmptyState
            title="No sync runs yet"
            sub="First sync runs automatically at next 6-hour tick (0 */6 * * *)."
          />
        )}
      </section>

      {/* ── Last Full Chain Scan ── */}
      <section>
        <SectionHeading>Last Full Chain Scan</SectionHeading>
        {loading ? (
          <SkeletonGrid cols={4} count={4} />
        ) : scanMeta ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Programs Found"
              value={(scanMeta.programs_found ?? 0).toLocaleString()}
              sub="total on-chain programs"
            />
            <StatCard
              label="Queued"
              value={(scanMeta.queued ?? 0).toLocaleString()}
              sub="added to discovery queue"
            />
            <StatCard
              label="Skipped"
              value={(scanMeta.skipped ?? 0).toLocaleString()}
              sub="invalid program IDs"
            />
            <div className="flex flex-col gap-1 border border-border-low bg-bg2 px-4 py-3">
              <span className="text-[10px] font-medium uppercase tracking-wider text-sand-900">Scanned At</span>
              <span className="text-lg font-bold text-sand-1600">{formatDate(scanMeta.scanned_at)}</span>
              <span className="text-[10px] text-sand-800">{formatRelative(scanMeta.scanned_at)}</span>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No scan data yet"
            sub="Daily scan runs at 1am UTC via GitHub Actions."
          />
        )}
      </section>

      {/* ── Discovery Queue ── */}
      <section>
        <SectionHeading>Discovery Queue</SectionHeading>
        {loading ? (
          <SkeletonGrid cols={4} count={4} />
        ) : candidates ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Total in Queue"
              value={(candidates.total ?? 0).toLocaleString()}
              sub="unique program IDs"
            />
            <StatCard
              label="Pending"
              value={(candidates.pending ?? 0).toLocaleString()}
              sub="awaiting cron check"
            />
            <StatCard
              label="Has IDL"
              value={(candidates.has_idl ?? 0).toLocaleString()}
              sub="verified + imported"
            />
            <StatCard
              label="No IDL"
              value={(candidates.no_idl ?? 0).toLocaleString()}
              sub="no on-chain IDL"
            />
          </div>
        ) : (
          <EmptyState title="No candidates queued yet" />
        )}
      </section>

    </div>
  )
}
