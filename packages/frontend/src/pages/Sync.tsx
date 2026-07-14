import { useEffect, useState, useCallback } from 'react'
import {
  getSyncStatus,
  getCandidateStats,
  getScanMetadata,
  getVerifiedBuildMetadata,
  getVerifiedBuildTotal,
  getPublicStats,
  type SyncRun,
  type CandidateStats,
  type ScanMetadata,
  type VerifiedBuildMetadata,
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

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border border-border-low bg-bg2 px-4 py-3">
      <span className="text-[10px] font-medium uppercase tracking-wider text-sand-900">{label}</span>
      <span className="text-xl font-bold tabular-nums text-sand-1600">{value}</span>
      {sub && <span className="text-[10px] text-sand-800">{sub}</span>}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Sync(): JSX.Element {
  const [run, setRun] = useState<SyncRun | null>(null)
  const [updatedToday, setUpdatedToday] = useState(0)
  const [publicStats, setPublicStats] = useState<PublicStats | null>(null)
  const [candidates, setCandidates] = useState<CandidateStats | null>(null)
  const [scanMeta, setScanMeta] = useState<ScanMetadata | null>(null)
  const [verifiedBuildMeta, setVerifiedBuildMeta] = useState<VerifiedBuildMetadata | null>(null)
  const [verifiedBuildTotal, setVerifiedBuildTotal] = useState<VerifiedBuildTotal | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const statusData = await getSyncStatus()
      setRun(statusData.run)
      setUpdatedToday(statusData.updated_today ?? 0)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? 'Failed to load sync status')
    }

    try {
      const stats = await getPublicStats()
      setPublicStats(stats)
    } catch {
      // non-fatal
    }

    // Fetch candidates stats separately — table may not exist yet (migration 018)
    try {
      const candidateData = await getCandidateStats()
      setCandidates(candidateData.stats)
    } catch {
      // program_candidates table not created yet — show empty state, not an error
    }

    // Fetch last scan metadata — non-critical, from KV
    try {
      const scanData = await getScanMetadata()
      setScanMeta(scanData.metadata)
    } catch {
      // non-fatal
    }

    // Fetch verified-build metadata from funnel stage — non-critical, from KV
    try {
      const verifiedData = await getVerifiedBuildMetadata()
      setVerifiedBuildMeta(verifiedData.metadata)
    } catch {
      // non-fatal
    }

    // Fetch OSEC live verified-program total — non-critical
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

  return (
    <div className="space-y-10 px-6 py-10 sm:px-8 sm:py-12">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-sand-1600">IDL Sync Dashboard</h1>
          <p className="mt-1 text-sand-1000">
            Automated 6-hour sync of all on-chain IDLs — PMP &amp; Anchor formats
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-sand-900">
          <span className={`inline-block h-2 w-2 rounded-full ${
            run?.status === 'running'
              ? 'animate-pulse bg-yellow-400'
              : run?.status === 'partial'
                ? 'bg-orange-400'
                : run?.completed_at
                  ? 'bg-green-500'
                  : 'bg-sand-600'
          }`} />
          {run ? (
            run.status === 'running'
              ? `Sync running (started ${formatRelative(run.started_at)})`
              : run.status === 'partial'
                ? `Partial run ${formatRelative(run.completed_at!)} — resumed via checkpoint`
                : `Last sync ${formatRelative(run.completed_at!)}`
          ) : loading ? (
            'Loading…'
          ) : (
            'No sync runs recorded yet'
          )}
        </div>
      </div>

      {error && (
        <div className="border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Summary stats */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sand-1000">
          Overview
        </h2>
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse border border-border-low bg-bg2 px-5 py-4">
                <div className="mb-2 h-3 w-20 rounded bg-sand-200" />
                <div className="h-7 w-16 rounded bg-sand-300" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Active Programs"
              value={(publicStats?.total_projects ?? 0).toLocaleString()}
              sub="public indexed programs"
            />
            <StatCard
              label="IDL Updates Today"
              value={updatedToday.toLocaleString()}
              sub="new versions detected"
            />
            <StatCard
              label="OSEC Verified (Live)"
              value={(verifiedBuildTotal?.total ?? 0).toLocaleString()}
              sub={verifiedBuildTotal?.fetched_at ? formatRelative(verifiedBuildTotal.fetched_at) : 'not fetched yet'}
            />
            <StatCard
              label="Queue Pending"
              value={(candidates?.pending ?? 0).toLocaleString()}
              sub="awaiting cron check"
            />
          </div>
        )}
      </section>

      {/* Latest Sync Run */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sand-1000">
          Latest Sync Run
        </h2>
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse border border-border-low bg-bg2 px-5 py-4">
                <div className="mb-2 h-3 w-16 rounded bg-sand-200" />
                <div className="h-6 w-12 rounded bg-sand-300" />
              </div>
            ))}
          </div>
        ) : run ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard
                label="Programs Checked"
                value={`${(run.total_checked ?? 0).toLocaleString()}${(run.total_programs ?? 0) > 0 && run.total_programs !== run.total_checked ? ` / ${(run.total_programs ?? 0).toLocaleString()}` : ''}`}
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
          <div className="border border-border-low px-6 py-8 text-center">
            <p className="font-medium text-sand-1200">No sync runs yet</p>
            <p className="mt-1 text-sm text-sand-900">
              First sync runs automatically at next 6-hour cron tick (<code className="font-mono">0 */6 * * *</code>).
            </p>
          </div>
        )}
      </section>

      {/* Last Full Chain Scan */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sand-1000">
          Last Full Chain Scan
        </h2>
        {loading ? (
          <div className="animate-pulse border border-border-low bg-bg2 px-5 py-4">
            <div className="mb-2 h-3 w-32 rounded bg-sand-200" />
            <div className="h-5 w-48 rounded bg-sand-300" />
          </div>
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
            <div className="flex flex-col gap-1 border border-border-low bg-bg2 px-5 py-4">
              <span className="text-xs font-medium uppercase tracking-wider text-sand-1000">Scanned At</span>
              <span className="text-lg font-bold text-sand-1600">{formatDate(scanMeta.scanned_at)}</span>
              <span className="text-xs text-sand-900">{formatRelative(scanMeta.scanned_at)}</span>
            </div>
          </div>
        ) : (
          <div className="border border-border-low px-6 py-8 text-center">
            <p className="font-medium text-sand-1200">No scan data yet</p>
            <p className="mt-1 text-sm text-sand-900">
              The daily GitHub Actions workflow runs at 1am UTC and scans all ~500K Solana programs.
              After the first run, scan stats will appear here.
            </p>
            <p className="mt-3 font-mono text-xs text-sand-800">
              Or trigger manually: <code>bun run cli:scan && bun run cli:queue</code>
            </p>
          </div>
        )}
      </section>

      {/* Last Verified Build Scan */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sand-1000">
          Last Verified Build Scan
        </h2>
        {loading ? (
          <div className="animate-pulse border border-border-low bg-bg2 px-5 py-4">
            <div className="mb-2 h-3 w-36 rounded bg-sand-200" />
            <div className="h-5 w-52 rounded bg-sand-300" />
          </div>
        ) : (verifiedBuildMeta || verifiedBuildTotal) ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            <StatCard
              label="OSEC Verified (Live)"
              value={(verifiedBuildTotal?.total ?? 0).toLocaleString()}
              sub={verifiedBuildTotal?.fetched_at ? formatRelative(verifiedBuildTotal.fetched_at) : 'not fetched yet'}
            />
            <StatCard
              label="Programs Checked"
              value={(verifiedBuildMeta?.total_programs ?? 0).toLocaleString()}
              sub="valid Solana programs"
            />
            <StatCard
              label="Verified Build"
              value={(verifiedBuildMeta?.verified_programs ?? 0).toLocaleString()}
              sub="latest funnel run"
            />
            <StatCard
              label="Verification Errors"
              value={(verifiedBuildMeta?.verification_errors ?? 0).toLocaleString()}
              sub={(verifiedBuildMeta?.verification_errors ?? 0) > 0 ? 'retry suggested' : 'clean run'}
            />
            <div className="flex flex-col gap-1 border border-border-low bg-bg2 px-5 py-4">
              <span className="text-xs font-medium uppercase tracking-wider text-sand-1000">Scanned At</span>
              <span className="text-lg font-bold text-sand-1600">
                {verifiedBuildMeta?.scanned_at ? formatDate(verifiedBuildMeta.scanned_at) : 'N/A'}
              </span>
              <span className="text-xs text-sand-900">
                {verifiedBuildMeta?.scanned_at
                  ? `${verifiedBuildMeta.source} · ${formatRelative(verifiedBuildMeta.scanned_at)}`
                  : 'Run funnel for local stage stats'}
              </span>
            </div>
          </div>
        ) : (
          <div className="border border-border-low px-6 py-8 text-center">
            <p className="font-medium text-sand-1200">No verified-build data yet</p>
            <p className="mt-1 text-sm text-sand-900">
              Run funnel once to publish verified-build totals to this dashboard.
            </p>
          </div>
        )}
      </section>

      {/* Candidates Queue */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sand-1000">
          Discovery Queue
        </h2>
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse border border-border-low bg-bg2 px-5 py-4">
                <div className="mb-2 h-3 w-16 rounded bg-sand-200" />
                <div className="h-6 w-12 rounded bg-sand-300" />
              </div>
            ))}
          </div>
        ) : candidates ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="Total Queued"
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
                sub="no on-chain IDL, skipped"
              />
            </div>
            <p className="mt-2 text-xs text-sand-900">
              Add new program IDs: <code className="font-mono">bun run cli:queue</code>
            </p>
          </>
        ) : (
          <div className="border border-border-low px-6 py-8 text-center">
            <p className="font-medium text-sand-1200">No candidates queued yet</p>
          </div>
        )}
      </section>

     
    </div>
  )
}
