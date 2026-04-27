import { useEffect, useState } from 'react'
import { useAnalyticsStore } from '@/store/analytics'
import type { DailyApiEntry, DailyMcpEntry } from '@/api/client'

// ── MCP tool_id → readable name ──────────────────────────────────────────────

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

// ── Format YYYYMMDD integer to "Apr 27" ──────────────────────────────────────

function formatDate(d: number): string {
  const s = String(d)
  const year = parseInt(s.slice(0, 4), 10)
  const month = parseInt(s.slice(4, 6), 10) - 1
  const day = parseInt(s.slice(6, 8), 10)
  return new Date(year, month, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── SVG Bar Chart ─────────────────────────────────────────────────────────────

interface BarChartProps {
  data: { label: string; value: number }[]
  color: string
  height?: number
}

function BarChart({ data, color, height = 120 }: BarChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; value: number } | null>(null)

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-600 text-sm">
        No data yet
      </div>
    )
  }

  const max = Math.max(...data.map((d) => d.value), 1)
  const barWidth = 100 / data.length

  return (
    <div className="relative select-none">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        onMouseLeave={() => setTooltip(null)}
      >
        {data.map((d, i) => {
          const barH = (d.value / max) * (height - 16)
          const x = i * barWidth + barWidth * 0.15
          const w = barWidth * 0.7
          const y = height - barH - 4
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={w}
              height={barH}
              rx="1.5"
              fill={color}
              opacity={d.value === 0 ? 0.15 : 0.85}
              className="transition-opacity duration-150 hover:opacity-100 cursor-pointer"
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

      {/* X-axis labels — every ~5th bar to avoid clutter */}
      <div className="flex" style={{ marginTop: 4 }}>
        {data.map((d, i) => (
          <div
            key={i}
            className="text-center overflow-hidden"
            style={{ width: `${barWidth}%`, fontSize: 9, color: '#6b7280' }}
          >
            {i % Math.ceil(data.length / 8) === 0 ? d.label.split(' ')[1] : ''}
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg bg-dark-900/95 border border-white/10 px-3 py-2 text-xs shadow-xl"
          style={{ left: tooltip.x - 60, top: tooltip.y - 48, minWidth: 120 }}
        >
          <p className="text-gray-400">{tooltip.label}</p>
          <p className="font-bold text-white">{tooltip.value.toLocaleString()} requests</p>
        </div>
      )}
    </div>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: number | string
  icon: React.ReactNode
  isLoading?: boolean
}

function StatCard({ label, value, icon, isLoading }: StatCardProps) {
  if (isLoading) {
    return (
      <div className="card-static p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/5 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-white/10 rounded animate-pulse w-24" />
            <div className="h-7 bg-white/10 rounded animate-pulse w-16" />
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="card-static p-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <p className="text-gray-400 text-sm">{label}</p>
          <p className="text-3xl font-bold text-white">{typeof value === 'number' ? value.toLocaleString() : value}</p>
        </div>
      </div>
    </div>
  )
}

// ── Section skeleton ──────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="card-static p-6 space-y-4">
      <div className="h-4 bg-white/10 rounded animate-pulse w-48" />
      <div className="flex items-end gap-1 h-32">
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-white/10 rounded animate-pulse"
            style={{ height: `${20 + Math.random() * 80}%` }}
          />
        ))}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

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
  }, [])

  // Aggregate daily API data
  const dailyApiData: { label: string; value: number }[] = (analytics?.daily_api ?? []).map(
    (d: DailyApiEntry) => ({ label: formatDate(d.date), value: d.total }),
  )

  // Aggregate daily MCP — sum all tools per day
  const mcpByDate = new Map<number, number>()
  for (const d of analytics?.daily_mcp ?? []) {
    mcpByDate.set(d.date, (mcpByDate.get(d.date) ?? 0) + d.total)
  }
  const dailyMcpData = [...mcpByDate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([date, total]) => ({ label: formatDate(date), value: total }))

  // MCP per-tool totals (all time from the 30-day window)
  const toolTotals = new Map<number, number>()
  for (const d of analytics?.daily_mcp ?? []) {
    toolTotals.set(d.tool_id, (toolTotals.get(d.tool_id) ?? 0) + d.total)
  }
  const toolBreakdown = [...toolTotals.entries()].sort(([, a], [, b]) => b - a)

  // Today's totals
  const todayInt = (() => {
    const n = new Date()
    return n.getUTCFullYear() * 10000 + (n.getUTCMonth() + 1) * 100 + n.getUTCDate()
  })()
  const todayApi = analytics?.daily_api.find((d: DailyApiEntry) => d.date === todayInt)?.total ?? 0
  const todayMcp = [...(analytics?.daily_mcp ?? [])]
    .filter((d: DailyMcpEntry) => d.date === todayInt)
    .reduce((s, d) => s + d.total, 0)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Analytics</h1>
          <p className="text-gray-400 mt-1 text-sm">Platform usage — last 30 days</p>
        </div>
        {analytics && !isLoadingAnalytics && (
          <button
            type="button"
            onClick={() => loadAnalytics()}
            className="btn-secondary text-sm px-3 py-2.5"
            title="Refresh"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="card-static p-4 border-red-500/20 bg-red-500/5 text-red-400 text-sm flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {/* Stat cards — top row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Users"
          value={stats?.total_users ?? 0}
          isLoading={isLoadingStats}
          icon={
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
        <StatCard
          label="Total Projects"
          value={stats?.total_projects ?? 0}
          isLoading={isLoadingStats}
          icon={
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
        <StatCard
          label="API Requests Today"
          value={isLoadingAnalytics ? '—' : todayApi}
          isLoading={isLoadingStats && !analytics}
          icon={
            <svg className="w-5 h-5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
        <StatCard
          label="MCP Calls Today"
          value={isLoadingAnalytics ? '—' : todayMcp}
          isLoading={isLoadingStats && !analytics}
          icon={
            <svg className="w-5 h-5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          }
        />
      </div>

      {/* Charts — skeleton while loading */}
      {isLoadingAnalytics && (
        <div className="space-y-4">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      )}

      {analytics && !isLoadingAnalytics && (
        <>
          {/* Daily API chart */}
          <div className="card-static p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Daily API Requests</h2>
              <span className="badge-primary text-xs px-2.5 py-1">
                {dailyApiData.reduce((s, d) => s + d.value, 0).toLocaleString()} total
              </span>
            </div>
            <BarChart data={dailyApiData} color="#14F195" />
          </div>

          {/* Daily MCP chart */}
          <div className="card-static p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Daily MCP Tool Calls</h2>
              <span className="text-xs px-2.5 py-1 rounded-full bg-secondary/10 border border-secondary/20 text-secondary font-medium">
                {dailyMcpData.reduce((s, d) => s + d.value, 0).toLocaleString()} total
              </span>
            </div>
            <BarChart data={dailyMcpData} color="#00D9FF" />

            {/* Tool breakdown */}
            {toolBreakdown.length > 0 && (
              <div className="mt-6 border-t border-white/5 pt-5">
                <p className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-3">By Tool (30-day)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {toolBreakdown.map(([toolId, count]) => {
                    const maxCount = toolBreakdown[0][1]
                    const pct = maxCount ? (count / maxCount) * 100 : 0
                    return (
                      <div key={toolId} className="flex items-center gap-3">
                        <span className="text-xs text-gray-500 w-36 truncate shrink-0">
                          {MCP_TOOL_NAMES[toolId] ?? `tool_${toolId}`}
                        </span>
                        <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, backgroundColor: '#00D9FF' }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 w-10 text-right shrink-0">
                          {count.toLocaleString()}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Top Programs table */}
          {analytics.top_programs.length > 0 && (
            <div className="card-static p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Top Programs</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-white/5">
                      <th className="pb-3 text-left w-8">#</th>
                      <th className="pb-3 text-left">Program</th>
                      <th className="pb-3 text-left hidden md:table-cell">Program ID</th>
                      <th className="pb-3 text-right">Requests</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {analytics.top_programs.map((p, i) => {
                      const maxTotal = analytics.top_programs[0].total
                      const pct = maxTotal ? (p.total / maxTotal) * 100 : 0
                      return (
                        <tr key={p.project_id} className="hover:bg-white/2 transition-colors">
                          <td className="py-3 text-gray-600 text-xs font-mono">{i + 1}</td>
                          <td className="py-3">
                            <div className="flex flex-col gap-1">
                              <span className="text-white font-medium">{p.name ?? p.project_id}</span>
                              <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden max-w-xs">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${pct}%`, backgroundColor: '#14F195' }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-3 hidden md:table-cell">
                            <span className="text-gray-500 font-mono text-xs">
                              {p.project_id.length > 12
                                ? `${p.project_id.slice(0, 6)}…${p.project_id.slice(-4)}`
                                : p.project_id}
                            </span>
                          </td>
                          <td className="py-3 text-right text-primary font-medium tabular-nums">
                            {p.total.toLocaleString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
