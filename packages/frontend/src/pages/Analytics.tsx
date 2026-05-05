import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAnalyticsStore } from '@/store/analytics'
import type { DailyApiEntry, DailyMcpEntry } from '@/api/client'

const MCP_TOOL_NAMES: Record<number, string> = {
  0: 'search_programs',
  1: 'list_instructions',
  2: 'build_instruction',
  3: 'list_pda_accounts',
  4: 'derive_pda',
  5: 'read_llms_txt',
  6: 'get_ai_analysis',
  7: 'fetch_pda_data',
}

const skeletonHeights = [32, 58, 42, 74, 46, 88, 62, 38, 70, 52, 84, 45, 66, 92, 56, 76, 40, 64]

function formatDate(d: number): string {
  const s = String(d)
  const year = parseInt(s.slice(0, 4), 10)
  const month = parseInt(s.slice(4, 6), 10) - 1
  const day = parseInt(s.slice(6, 8), 10)
  return new Date(year, month, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}

interface BarChartProps {
  data: { label: string; value: number }[]
  color: string
  glowColor: string
  height?: number
}

function BarChart({ data, color, glowColor, height = 148 }: BarChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; value: number } | null>(null)

  if (data.length === 0) {
    return <EmptyState title="No chart data yet" desc="Requests appear here after API or MCP traffic arrives." />
  }

  const max = Math.max(...data.map((d) => d.value), 1)
  const barWidth = 100 / data.length
  const labelStep = Math.max(1, Math.ceil(data.length / 7))

  return (
    <div className="relative select-none">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full overflow-visible"
        style={{ height }}
        onMouseLeave={() => setTooltip(null)}
        role="img"
        aria-label="Usage bar chart"
      >
        <defs>
          <linearGradient id={`bar-${color.replace('#', '')}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.28" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((line) => (
          <line key={line} x1="0" x2="100" y1={height * line} y2={height * line} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
        ))}
        {data.map((d, i) => {
          const barH = Math.max(3, (d.value / max) * (height - 24))
          const x = i * barWidth + barWidth * 0.18
          const w = Math.max(1.2, barWidth * 0.64)
          const y = height - barH - 10
          return (
            <rect
              key={`${d.label}-${i}`}
              x={x}
              y={y}
              width={w}
              height={barH}
              rx="1.8"
              fill={`url(#bar-${color.replace('#', '')})`}
              opacity={d.value === 0 ? 0.2 : 0.95}
              className="cursor-pointer motion-safe:transition-opacity motion-safe:duration-150 hover:opacity-100"
              style={{ filter: d.value > 0 ? `drop-shadow(0 0 7px ${glowColor})` : undefined }}
              onMouseEnter={(e) => {
                const svg = (e.target as SVGRectElement).closest('svg')!
                const rect = svg.getBoundingClientRect()
                const cx = rect.left + (i + 0.5) * (rect.width / data.length)
                const cy = rect.top + y * (rect.height / height)
                setTooltip({ x: cx, y: cy, label: d.label, value: d.value })
              }}
            />
          )
        })}
      </svg>

      <div className="mt-3 flex">
        {data.map((d, i) => (
          <div key={`${d.label}-label`} className="overflow-hidden text-center text-[10px] text-gray-500" style={{ width: `${barWidth}%` }}>
            {i % labelStep === 0 ? d.label.split(' ')[1] : ''}
          </div>
        ))}
      </div>

      {tooltip && (
        <div
          className="fixed z-50 min-w-[132px] pointer-events-none rounded-xl border border-white/10 bg-dark-900/95 px-3 py-2 text-xs shadow-2xl backdrop-blur"
          style={{ left: tooltip.x - 66, top: tooltip.y - 54 }}
        >
          <p className="text-gray-400">{tooltip.label}</p>
          <p className="mt-0.5 font-bold text-white">{tooltip.value.toLocaleString()} requests</p>
        </div>
      )}
    </div>
  )
}

interface StatCardProps {
  label: string
  value: number | string
  icon: ReactNode
  isLoading?: boolean
  tone?: 'primary' | 'secondary'
  hint?: string
}

function StatCard({ label, value, icon, isLoading, tone = 'primary', hint }: StatCardProps) {
  const toneClass = tone === 'primary'
    ? 'border-primary/20 bg-primary/10 text-primary shadow-[0_0_32px_rgba(20,241,149,0.08)]'
    : 'border-secondary/20 bg-secondary/10 text-secondary shadow-[0_0_32px_rgba(0,217,255,0.08)]'

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-surface-card/80 p-5">
        <div className="h-10 w-10 rounded-xl bg-white/10 motion-safe:animate-pulse" />
        <div className="mt-5 h-3 w-24 rounded bg-white/10 motion-safe:animate-pulse" />
        <div className="mt-3 h-8 w-20 rounded bg-white/10 motion-safe:animate-pulse" />
      </div>
    )
  }

  return (
    <div className="group overflow-hidden rounded-2xl border border-white/10 bg-surface-card/80 p-5 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:hover:-translate-y-1">
      <div className="flex items-start justify-between gap-4">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl border ${toneClass}`}>{icon}</div>
        {hint && <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-gray-400">{hint}</span>}
      </div>
      <p className="mt-5 text-xs font-medium uppercase tracking-[0.16em] text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight text-white">{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  )
}

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
      <p className="font-semibold text-white">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-6 text-gray-500">{desc}</p>
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div className="rounded-2xl border border-white/10 bg-surface-card/80 p-5">
      <div className="h-5 w-52 rounded bg-white/10 motion-safe:animate-pulse" />
      <div className="mt-7 flex h-36 items-end gap-1.5">
        {skeletonHeights.map((height, i) => (
          <div key={i} className="flex-1 rounded-t bg-white/10 motion-safe:animate-pulse" style={{ height: `${height}%` }} />
        ))}
      </div>
    </div>
  )
}

function RefreshIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

export default function Analytics() {
  const {
    stats,
    analytics,
    isLoadingStats,
    isLoadingAnalytics,
    error,
    loadStats,
    loadAnalytics,
  } = useAnalyticsStore()

  useEffect(() => {
    loadStats()
    loadAnalytics()
  }, [loadStats, loadAnalytics])

  const dailyApiData: { label: string; value: number }[] = useMemo(
    () => (analytics?.daily_api ?? []).map((d: DailyApiEntry) => ({ label: formatDate(d.date), value: d.total })),
    [analytics?.daily_api],
  )

  const dailyMcpData = useMemo(() => {
    const mcpByDate = new Map<number, number>()
    for (const d of analytics?.daily_mcp ?? []) {
      mcpByDate.set(d.date, (mcpByDate.get(d.date) ?? 0) + d.total)
    }
    return [...mcpByDate.entries()]
      .sort(([a], [b]) => a - b)
      .map(([date, total]) => ({ label: formatDate(date), value: total }))
  }, [analytics?.daily_mcp])

  const toolBreakdown = useMemo(() => {
    const toolTotals = new Map<number, number>()
    for (const d of analytics?.daily_mcp ?? []) {
      toolTotals.set(d.tool_id, (toolTotals.get(d.tool_id) ?? 0) + d.total)
    }
    return [...toolTotals.entries()].sort(([, a], [, b]) => b - a)
  }, [analytics?.daily_mcp])

  const totals = useMemo(() => {
    const today = new Date()
    const todayInt = today.getUTCFullYear() * 10000 + (today.getUTCMonth() + 1) * 100 + today.getUTCDate()
    const api30d = dailyApiData.reduce((s, d) => s + d.value, 0)
    const mcp30d = dailyMcpData.reduce((s, d) => s + d.value, 0)
    const todayApi = analytics?.daily_api.find((d: DailyApiEntry) => d.date === todayInt)?.total ?? 0
    const todayMcp = [...(analytics?.daily_mcp ?? [])]
      .filter((d: DailyMcpEntry) => d.date === todayInt)
      .reduce((s, d) => s + d.total, 0)
    return { api30d, mcp30d, todayApi, todayMcp }
  }, [analytics?.daily_api, analytics?.daily_mcp, dailyApiData, dailyMcpData])

  const activeTools = toolBreakdown.filter(([, count]) => count > 0).length
  const topProgram = analytics?.top_programs[0]

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-surface-card px-5 py-7 md:px-8 md:py-9">
        <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-60" />
        <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -right-24 bottom-0 h-72 w-72 rounded-full bg-secondary/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_14px_rgba(20,241,149,0.9)]" />
              Platform telemetry - last 30 days
            </div>
            <h1 className="text-balance text-4xl font-light leading-[1.02] tracking-[-0.045em] text-white md:text-5xl">
              Analytics for{' '}
              <span className="gradient-text font-black">
                REST APIs and MCP agents
              </span>
              <span className="font-light text-gray-200">.</span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-gray-400 md:text-base">
              Clear usage signals for Orquestra adoption: program traffic, API calls, MCP tool demand, and daily momentum.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              loadStats()
              loadAnalytics()
            }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-gray-300 transition-colors duration-150 hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <RefreshIcon />
            Refresh
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
          <div className="flex items-start gap-3">
            <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-semibold text-red-200">Analytics failed to load</p>
              <p className="mt-1 text-red-300/80">{error}</p>
            </div>
          </div>
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total users"
          value={stats?.total_users ?? 0}
          isLoading={isLoadingStats}
          hint="public"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
        <StatCard
          label="Total projects"
          value={stats?.total_projects ?? 0}
          isLoading={isLoadingStats}
          hint="catalog"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
        <StatCard
          label="API today"
          value={isLoadingAnalytics ? '-' : totals.todayApi}
          isLoading={isLoadingAnalytics && !analytics}
          hint={`${formatCompact(totals.api30d)} 30d`}
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
        <StatCard
          label="MCP today"
          value={isLoadingAnalytics ? '-' : totals.todayMcp}
          isLoading={isLoadingAnalytics && !analytics}
          tone="secondary"
          hint={`${activeTools} tools`}
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          }
        />
      </section>

      {analytics && !isLoadingAnalytics && (
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-primary/15 bg-primary/10 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">30d API volume</p>
            <p className="mt-2 text-2xl font-black text-white">{totals.api30d.toLocaleString()}</p>
            <p className="mt-1 text-sm text-gray-400">REST request demand</p>
          </div>
          <div className="rounded-2xl border border-secondary/15 bg-secondary/10 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-secondary">30d MCP volume</p>
            <p className="mt-2 text-2xl font-black text-white">{totals.mcp30d.toLocaleString()}</p>
            <p className="mt-1 text-sm text-gray-400">Agent tool calls</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-surface-elevated/70 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-500">Top program</p>
            <p className="mt-2 truncate text-2xl font-black text-white">{topProgram?.name ?? topProgram?.project_id ?? 'No traffic'}</p>
            <p className="mt-1 text-sm text-gray-400">{topProgram ? `${topProgram.total.toLocaleString()} requests` : 'Waiting for usage'}</p>
          </div>
        </section>
      )}

      {isLoadingAnalytics && !analytics && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      )}

      {analytics && !isLoadingAnalytics && (
        <>
          <section className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-surface-card/80 p-5">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">REST API</p>
                  <h2 className="mt-1 text-xl font-bold text-white">Daily API requests</h2>
                </div>
                <span className="w-fit rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  {totals.api30d.toLocaleString()} total
                </span>
              </div>
              <BarChart data={dailyApiData} color="#14F195" glowColor="rgba(20,241,149,0.28)" />
            </div>

            <div className="rounded-2xl border border-white/10 bg-surface-card/80 p-5">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-secondary">MCP agents</p>
                  <h2 className="mt-1 text-xl font-bold text-white">Daily MCP tool calls</h2>
                </div>
                <span className="w-fit rounded-full border border-secondary/20 bg-secondary/10 px-3 py-1 text-xs font-medium text-secondary">
                  {totals.mcp30d.toLocaleString()} total
                </span>
              </div>
              <BarChart data={dailyMcpData} color="#00D9FF" glowColor="rgba(0,217,255,0.28)" />
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-white/10 bg-surface-card/80 p-5">
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-secondary">Agent behavior</p>
                <h2 className="mt-1 text-xl font-bold text-white">MCP tool breakdown</h2>
              </div>

              {toolBreakdown.length > 0 ? (
                <div className="space-y-3">
                  {toolBreakdown.map(([toolId, count]) => {
                    const maxCount = toolBreakdown[0][1]
                    const pct = maxCount ? (count / maxCount) * 100 : 0
                    return (
                      <div key={toolId} className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <code className="truncate font-mono text-xs text-secondary">{MCP_TOOL_NAMES[toolId] ?? `tool_${toolId}`}</code>
                          <span className="font-mono text-xs text-gray-300">{count.toLocaleString()}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/5">
                          <div className="h-full rounded-full bg-gradient-to-r from-secondary to-primary motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <EmptyState title="No MCP calls yet" desc="Connect an AI agent through MCP to populate tool demand." />
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-surface-card/80 p-5">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Program demand</p>
                  <h2 className="mt-1 text-xl font-bold text-white">Top programs</h2>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-gray-400">
                  30d
                </span>
              </div>

              {analytics.top_programs.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-xs uppercase tracking-[0.16em] text-gray-500">
                        <th className="pb-3 text-left font-semibold">#</th>
                        <th className="pb-3 text-left font-semibold">Program</th>
                        <th className="hidden pb-3 text-left font-semibold md:table-cell">Program ID</th>
                        <th className="pb-3 text-right font-semibold">Requests</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {analytics.top_programs.map((program, i) => {
                        const maxTotal = analytics.top_programs[0].total
                        const pct = maxTotal ? (program.total / maxTotal) * 100 : 0
                        return (
                          <tr key={program.project_id} className="transition-colors duration-150 hover:bg-white/[0.03]">
                            <td className="py-4 pr-3 font-mono text-xs text-gray-500">{i + 1}</td>
                            <td className="py-4 pr-4">
                              <div className="min-w-[180px]">
                                <p className="truncate font-semibold text-white">{program.name ?? program.project_id}</p>
                                <div className="mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-white/5">
                                  <div className="h-full rounded-full bg-gradient-to-r from-primary to-secondary" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            </td>
                            <td className="hidden py-4 pr-4 md:table-cell">
                              <span className="font-mono text-xs text-gray-500">{shortId(program.project_id)}</span>
                            </td>
                            <td className="py-4 text-right font-mono font-semibold tabular-nums text-primary">
                              {program.total.toLocaleString()}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No program traffic yet" desc="Programs with API usage will rank here automatically." />
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
