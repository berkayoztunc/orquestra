import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  getSyncStatus,
  getSyncHistory,
  getDiscoveryFeed,
  getCandidateStats,
  getScanMetadata,
  getVerifiedBuildMetadata,
  getVerifiedBuildTotal,
  type SyncRun,
  type SyncUpdate,
  type DiscoveredProgram,
  type CandidateStats,
  type ScanMetadata,
  type VerifiedBuildMetadata,
  type VerifiedBuildTotal,
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

const CATEGORY_LABELS: Record<string, string> = {
  'dex-amm': 'DEX / AMM',
  lending: 'Lending',
  staking: 'Staking',
  'nft-marketplace': 'NFT Marketplace',
  'token-launch': 'Token Launch',
  gaming: 'Gaming',
  payments: 'Payments',
  governance: 'Governance',
  perpetuals: 'Perpetuals',
  derivatives: 'Derivatives',
  infrastructure: 'Infrastructure',
  social: 'Social',
  other: 'Other',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 border border-border-low bg-bg2 px-5 py-4">
      <span className="text-xs font-medium uppercase tracking-wider text-sand-1000">{label}</span>
      <span className="text-2xl font-bold tabular-nums text-sand-1600">{value}</span>
      {sub && <span className="text-xs text-sand-900">{sub}</span>}
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="animate-pulse border border-border-low p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-4 w-44 rounded bg-sand-200" />
          <div className="h-3 w-64 rounded bg-sand-100" />
        </div>
        <div className="h-4 w-20 rounded bg-sand-100" />
      </div>
    </div>
  )
}

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="border border-border-low px-6 py-12 text-center">
      <p className="font-medium text-sand-1200">{title}</p>
      <p className="mt-1 text-sm text-sand-900">{desc}</p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Sync(): JSX.Element {
  const [run, setRun] = useState<SyncRun | null>(null)
  const [updates, setUpdates] = useState<SyncUpdate[]>([])
  const [updatesPagination, setUpdatesPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [discovery, setDiscovery] = useState<DiscoveredProgram[]>([])
  const [candidates, setCandidates] = useState<CandidateStats | null>(null)
  const [scanMeta, setScanMeta] = useState<ScanMetadata | null>(null)
  const [verifiedBuildMeta, setVerifiedBuildMeta] = useState<VerifiedBuildMetadata | null>(null)
  const [verifiedBuildTotal, setVerifiedBuildTotal] = useState<VerifiedBuildTotal | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatesLoading, setUpdatesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch sync status + discovery on mount (and every 30 s)
  const fetchStatus = useCallback(async () => {
    try {
      const [statusData, discoveryData] = await Promise.all([
        getSyncStatus(),
        getDiscoveryFeed({ days: 7, limit: 30 }),
      ])
      setRun(statusData.run)
      setDiscovery(discoveryData.programs)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? 'Failed to load sync status')
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

  const fetchUpdates = useCallback(async (page = 1) => {
    setUpdatesLoading(true)
    try {
      const data = await getSyncHistory({ page, limit: 20 })
      setUpdates(data.updates)
      setUpdatesPagination(data.pagination)
    } catch {
      // non-critical
    } finally {
      setUpdatesLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchUpdates()

    const interval = setInterval(fetchStatus, 30_000)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchUpdates])

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

      {/* Sync Status Card */}
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
          <EmptyState
            title="No sync runs yet"
            desc="The first sync will run automatically at the next 6-hour cron tick (0 */6 * * *)."
          />
        )}
      </section>

      {/* Recent IDL Updates */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sand-1000">
          Recent IDL Updates
          {(updatesPagination.total ?? 0) > 0 && (
            <span className="ml-2 font-normal text-sand-900">
              ({(updatesPagination.total ?? 0).toLocaleString()} total)
            </span>
          )}
        </h2>

        {updatesLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : updates.length === 0 ? (
          <EmptyState
            title="No IDL updates detected yet"
            desc="When the sync finds on-chain IDL changes, they appear here."
          />
        ) : (
          <div className="space-y-2">
            {updates.map((u) => (
              <div key={u.id} className="border border-border-low p-4 transition-colors hover:border-border-medium">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/project/${u.program_id}`}
                        className="font-semibold text-sand-1500 transition-colors hover:text-sand-1600 truncate"
                      >
                        {u.program_name || u.project_name || u.program_id}
                      </Link>
                      <span className="flex items-center gap-1 text-sm shrink-0">
                        <span className="text-sand-800">
                          {u.old_version !== null ? `v${u.old_version}` : 'new'}
                        </span>
                        <span className="text-sand-700">→</span>
                        <span className="font-medium text-sand-1400">v{u.new_version}</span>
                      </span>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-xs text-sand-900">
                      {u.program_id}
                    </p>
                  </div>
                  <time className="shrink-0 text-sm text-sand-900">
                    {formatDate(u.detected_at)}
                  </time>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {updatesPagination.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-4">
            <button
              onClick={() => fetchUpdates(updatesPagination.page - 1)}
              disabled={updatesPagination.page <= 1 || updatesLoading}
              className="border border-border-low px-4 py-2 text-sm text-sand-1200 transition-colors hover:border-border-medium hover:text-sand-1600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-sand-900">
              Page {updatesPagination.page} of {updatesPagination.totalPages}
            </span>
            <button
              onClick={() => fetchUpdates(updatesPagination.page + 1)}
              disabled={updatesPagination.page >= updatesPagination.totalPages || updatesLoading}
              className="border border-border-low px-4 py-2 text-sm text-sand-1200 transition-colors hover:border-border-medium hover:text-sand-1600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </section>

      {/* Discovery Feed */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sand-1000">
          Programs Discovered (Last 7 Days)
          {discovery.length > 0 && (
            <span className="ml-2 font-normal text-sand-900">
              ({discovery.length})
            </span>
          )}
        </h2>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : discovery.length === 0 ? (
          <EmptyState
            title="No new programs in the last 7 days"
            desc="Run the CLI check-idl --enable-ingest command to ingest new programs."
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {discovery.map((prog) => (
              <Link
                key={prog.id}
                to={`/project/${prog.program_id}`}
                className="group border border-border-low p-4 transition-colors hover:border-border-medium"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sand-1500 group-hover:text-sand-1600 truncate">
                    {prog.name}
                  </span>
                  {prog.category && (
                    <span className="shrink-0 rounded-sm border border-border-low bg-bg2 px-1.5 py-0.5 text-xs text-sand-1000">
                      {CATEGORY_LABELS[prog.category] ?? prog.category}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate font-mono text-xs text-sand-800">
                  {prog.program_id}
                </p>
                <p className="mt-1.5 text-xs text-sand-900">{formatRelative(prog.created_at)}</p>
              </Link>
            ))}
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
          <EmptyState
            title="No candidates queued yet"
            desc="Run bun run cli:scan then bun run cli:queue to populate the discovery queue."
          />
        )}
      </section>

      {/* Footer info */}
      <section className="border-t border-border-low pt-6 text-xs text-sand-900 space-y-1">
        <p>
          <span className="font-medium text-sand-1100">Sync cadence:</span> Every 6 hours via Cloudflare
          Workers Cron (<code className="font-mono">0 */6 * * *</code>)
        </p>
        <p>
          <span className="font-medium text-sand-1100">Time limit:</span> Cloudflare Workers cron
          triggers have a 15-minute wall-clock limit. The sync stops at 12 minutes and saves a KV
          checkpoint — the next cron run resumes from exactly where it left off.
        </p>
        <p>
          <span className="font-medium text-sand-1100">IDL sources:</span> PMP (Program Metadata Program)
          tried first, Anchor legacy account as fallback — using{' '}
          <a
            href="https://github.com/solana-foundation/idl"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-sand-1200"
          >
            @solana/idl
          </a>
        </p>
        <p>
          <span className="font-medium text-sand-1100">Bulk discovery:</span> Run{' '}
          <code className="font-mono">bun run cli:scan</code> to find all Solana programs, then{' '}
          <code className="font-mono">bun run cli:queue</code> to add them to the discovery queue.
          The cron verifies each for an on-chain IDL and auto-imports programs that have one.
          Programs without an IDL are permanently marked <em>no_idl</em> and never imported.
        </p>
      </section>
    </div>
  )
}
