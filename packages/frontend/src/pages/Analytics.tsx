import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAnalyticsStore } from '@/store/analytics'
import type { DailyApiEntry, DailyMcpEntry } from '@/api/client'
import { Card } from '@/ui/Card'
import { Button } from '@/ui/Button'

const MCP_TOOL_NAMES: Record<number, string> = {
  0: 'Search Programs',
  1: 'List instructions',
  2: 'Build instruction',
  3: 'List PDA accounts',
  4: 'Derive PDA',
  5: 'Read LLMs TXT',
  6: 'Get AI analysis',
  7: 'Fetch PDA data',
  8: 'Simulate instruction',
  9: 'Get program data',
  10: 'Simulate transaction',
  11: 'Get flow schema',
  12: 'Validate flow',
  13: 'Simulate flow',
  14: 'Publish flow',
  15: 'List flows',
  16: 'Get flow metadata',
  17: 'Estimate flow',
}

/** Cap on-screen rows so the page fits one viewport without scrolling. */
const MAX_TOOL_ROWS = 6

const skeletonHeights = [32, 58, 42, 74, 46, 88, 62, 38, 70, 52, 84, 45, 66, 92, 56, 76, 40, 64]

function formatDate(d: number): string {
  const s = String(d)
  const year = parseInt(s.slice(0, 4), 10)
  const month = parseInt(s.slice(4, 6), 10) - 1
  const day = parseInt(s.slice(6, 8), 10)
  return new Date(year, month, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}

function pct(n: number, total: number, decimals = 0): string {
  if (!total) return '0%'
  const value = (n / total) * 100
  return `${decimals ? value.toFixed(decimals) : Math.round(value)}%`
}

const CHART_COLORS = {
  primary: 'rgb(var(--rgb-sand-1600))',
  secondary: 'rgb(var(--rgb-sand-1100))',
} as const

interface BarChartProps {
  data: { label: string; value: number }[]
  tone?: 'primary' | 'secondary'
  height?: number
}

function BarChart({ data, tone = 'primary', height = 64 }: BarChartProps) {
  const color = CHART_COLORS[tone]
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
          <linearGradient id={`bar-${tone}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" style={{ stopColor: color, stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: color, stopOpacity: 0.3 }} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((line) => (
          <line key={line} x1="0" x2="100" y1={height * line} y2={height * line} style={{ stroke: 'rgb(var(--rgb-border-low))' }} strokeWidth="0.5" />
        ))}
        {data.map((d, i) => {
          const barH = Math.max(2, (d.value / max) * (height - 12))
          const x = i * barWidth + barWidth * 0.18
          const w = Math.max(1.2, barWidth * 0.64)
          const y = height - barH - 6
          return (
            <rect
              key={`${d.label}-${i}`}
              x={x}
              y={y}
              width={w}
              height={barH}
              rx="0"
              fill={`url(#bar-${tone})`}
              opacity={d.value === 0 ? 0.2 : 0.9}
              className="cursor-pointer motion-safe:transition-opacity motion-safe:duration-150 hover:opacity-100"
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

      <div className="mt-1.5 flex">
        {data.map((d, i) => (
          <div key={`${d.label}-label`} className="overflow-hidden text-center text-[10px] text-sand-1100" style={{ width: `${barWidth}%` }}>
            {i % labelStep === 0 ? d.label.split(' ')[1] : ''}
          </div>
        ))}
      </div>

      {tooltip && (
        <div
          className="fixed z-50 min-w-[132px] pointer-events-none border border-border-medium bg-bg1 px-3 py-2 text-xs shadow-lg"
          style={{ left: tooltip.x - 66, top: tooltip.y - 54 }}
        >
          <p className="text-sand-1200">{tooltip.label}</p>
          <p className="mt-0.5 font-bold text-sand-1600">{tooltip.value.toLocaleString()} requests</p>
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
  hint?: string
  size?: 'sm' | 'lg'
}

function StatCard({ label, value, icon, isLoading, hint, size = 'sm' }: StatCardProps) {
  if (isLoading) {
    return (
      <div className={`border border-border-low bg-bg1 ${size === 'lg' ? 'p-4' : 'p-3'}`}>
        <div className={`bg-sand-200 motion-safe:animate-pulse ${size === 'lg' ? 'h-9 w-9' : 'h-8 w-8'}`} />
        <div className="mt-3 h-2.5 w-20 bg-sand-200 motion-safe:animate-pulse" />
        <div className={`mt-2 bg-sand-200 motion-safe:animate-pulse ${size === 'lg' ? 'h-8 w-24' : 'h-6 w-16'}`} />
      </div>
    )
  }

  return (
    <div
      className={`group overflow-hidden border border-border-low bg-bg1 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:hover:-translate-y-0.5 ${size === 'lg' ? 'p-4' : 'p-3'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={`flex items-center justify-center border border-border-low bg-sand-100 text-sand-1500 ${size === 'lg' ? 'h-9 w-9' : 'h-8 w-8'}`}
        >
          {icon}
        </div>
        {hint && (
          <span className="truncate border border-border-low bg-sand-100 px-1.5 py-0.5 text-[10px] text-sand-1200">
            {hint}
          </span>
        )}
      </div>
      <p className="mt-3 truncate text-[11px] font-medium uppercase tracking-[0.14em] text-sand-1100">{label}</p>
      <p className={`mt-1 truncate font-black tracking-tight text-sand-1600 ${size === 'lg' ? 'text-3xl' : 'text-xl'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  )
}

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex min-h-20 flex-col items-center justify-center border border-dashed border-border-low bg-sand-50 px-4 py-4 text-center">
      <p className="text-sm font-semibold text-sand-1600">{title}</p>
      <p className="mt-0.5 max-w-sm text-xs leading-5 text-sand-1200">{desc}</p>
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div className="border border-border-low bg-bg1 p-4">
      <div className="h-4 w-40 bg-sand-200 motion-safe:animate-pulse" />
      <div className="mt-4 flex h-16 items-end gap-1">
        {skeletonHeights.map((height, i) => (
          <div key={i} className="flex-1 bg-sand-200 motion-safe:animate-pulse" style={{ height: `${height}%` }} />
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
  const analyticsReady = !!analytics && !isLoadingAnalytics

  return (
    <div className="space-y-3 px-6 py-6 sm:px-8 sm:py-8">
      <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-sand-1600 md:text-3xl">
            Analytics for API and MCP agents
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-sand-1200 sm:text-sm">
            Usage signals for Orquestra adoption: program traffic, API calls, and MCP tool demand.
          </p>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            loadStats()
            loadAnalytics()
          }}
        >
          <RefreshIcon />
          Refresh
        </Button>
      </section>

      {error && (
        <div className="border border-[#b75000]/20 bg-[#b75000]/5 p-3 text-sm">
          <div className="flex items-start gap-3">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-[#b75000]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-semibold text-[#b75000]">Analytics failed to load</p>
              <p className="mt-1 text-[#b75000]/80">{error}</p>
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-sand-1100">Overview</p>
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            size="lg"
            label="Total users"
            value={stats?.total_users ?? 0}
            isLoading={isLoadingStats}
            hint="public"
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          />
          <StatCard
            size="lg"
            label="Total programs"
            value={stats?.total_projects ?? 0}
            isLoading={isLoadingStats}
            hint="catalog"
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            }
          />
          <StatCard
            size="lg"
            label="Workflow runs"
            value={isLoadingAnalytics ? '-' : (analytics?.platform.workflow_runs_total ?? 0)}
            isLoading={isLoadingAnalytics && !analytics}
            hint="total"
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
          />
        </section>
      </div>

      <div>
        <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-sand-1100">Data coverage</p>
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            label="Have IDL"
            value={isLoadingAnalytics ? '-' : pct(analytics?.platform.programs_with_idl ?? 0, analytics?.platform.total_programs ?? 0)}
            isLoading={isLoadingAnalytics && !analytics}
            hint={analytics ? `${analytics.platform.programs_with_idl}/${analytics.platform.total_programs}` : undefined}
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
          />
          <StatCard
            label="Verified"
            value={isLoadingAnalytics ? '-' : pct(analytics?.platform.verified_programs ?? 0, analytics?.platform.total_programs ?? 0, 5)}
            isLoading={isLoadingAnalytics && !analytics}
            hint={analytics ? `${analytics.platform.verified_programs}/${analytics.platform.total_programs}` : undefined}
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
              </svg>
            }
          />
          <StatCard
            label="IDL + Verified"
            value={isLoadingAnalytics ? '-' : pct(analytics?.platform.programs_with_idl_and_verified ?? 0, analytics?.platform.total_programs ?? 0, 5)}
            isLoading={isLoadingAnalytics && !analytics}
            hint={analytics ? `${analytics.platform.programs_with_idl_and_verified}/${analytics.platform.total_programs}` : undefined}
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
              </svg>
            }
          />
          <StatCard
            label="Programs scanned"
            value={isLoadingAnalytics ? '-' : (analytics?.platform.total_programs ?? 0)}
            isLoading={isLoadingAnalytics && !analytics}
            hint="sync queue, all-time"
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            }
          />
          <StatCard
            label="IDL versions"
            value={isLoadingAnalytics ? '-' : (analytics?.platform.idl_versions_total ?? 0)}
            isLoading={isLoadingAnalytics && !analytics}
            hint="all versions"
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
            }
          />
          <StatCard
            label="Coverage gaps"
            value={
              isLoadingAnalytics
                ? '-'
                : Math.max((analytics?.platform.verified_programs ?? 0) - (analytics?.platform.programs_with_idl_and_verified ?? 0), 0) +
                  Math.max((analytics?.platform.programs_with_idl ?? 0) - (analytics?.platform.programs_with_idl_and_verified ?? 0), 0)
            }
            isLoading={isLoadingAnalytics && !analytics}
            hint="verified w/o IDL + IDL unverified"
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            }
          />
        </section>
      </div>

      <div>
        <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-sand-1100">Traffic</p>
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="API today"
            value={isLoadingAnalytics ? '-' : totals.todayApi}
            isLoading={isLoadingAnalytics && !analytics}
            hint="requests"
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
          />
          <StatCard
            label="MCP today"
            value={isLoadingAnalytics ? '-' : totals.todayMcp}
            isLoading={isLoadingAnalytics && !analytics}
            hint={`${activeTools} tools`}
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            }
          />
          <StatCard
            label="API all-time"
            value={isLoadingAnalytics ? '-' : (analytics?.totals_alltime.api ?? 0)}
            isLoading={isLoadingAnalytics && !analytics}
            hint="since launch"
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
          />
          <StatCard
            label="MCP all-time"
            value={isLoadingAnalytics ? '-' : (analytics?.totals_alltime.mcp ?? 0)}
            isLoading={isLoadingAnalytics && !analytics}
            hint="since launch"
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          />
        </section>
      </div>

      {isLoadingAnalytics && !analytics && (
        <div className="grid gap-3 lg:grid-cols-2">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      )}

      {analyticsReady && (
        <>
          <section className="grid gap-3 xl:grid-cols-2">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-sand-1600">Daily API requests</h2>
                <span className="w-fit border border-border-low bg-sand-100 px-2 py-0.5 text-[11px] font-medium text-sand-1500">
                  {totals.api30d.toLocaleString()} · 30d
                </span>
              </div>
              <BarChart data={dailyApiData} tone="primary" height={88} />
            </Card>

            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-sand-1600">Daily MCP tool calls</h2>
                <span className="w-fit border border-border-low bg-sand-100 px-2 py-0.5 text-[11px] font-medium text-sand-1500">
                  {totals.mcp30d.toLocaleString()} · 30d
                </span>
              </div>
              <BarChart data={dailyMcpData} tone="secondary" height={88} />
            </Card>
          </section>

          <section className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-sand-1600">MCP tool breakdown</h2>
                {toolBreakdown.length > MAX_TOOL_ROWS && (
                  <span className="font-mono text-[11px] text-sand-1000">+{toolBreakdown.length - MAX_TOOL_ROWS} more</span>
                )}
              </div>

              {toolBreakdown.length > 0 ? (
                <div className="space-y-1.5">
                  {toolBreakdown.slice(0, MAX_TOOL_ROWS).map(([toolId, count]) => {
                    const maxCount = toolBreakdown[0][1]
                    const pct = maxCount ? (count / maxCount) * 100 : 0
                    return (
                      <div key={toolId} className="border border-border-low bg-sand-50 p-2">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <code className="truncate font-mono text-xs text-sand-1500">{MCP_TOOL_NAMES[toolId] ?? `tool_${toolId}`}</code>
                          <span className="font-mono text-xs text-sand-1200">{count.toLocaleString()}</span>
                        </div>
                        <div className="h-1 overflow-hidden bg-sand-200">
                          <div className="h-full bg-sand-1600 motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <EmptyState title="No MCP calls yet" desc="Connect an AI agent through MCP to populate tool demand." />
              )}
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 text-sm font-bold text-sand-1600">Top programs</h2>

              {analytics.top_programs.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border-low text-[10px] uppercase tracking-[0.14em] text-sand-1100">
                        <th className="pb-1.5 text-left font-semibold">#</th>
                        <th className="pb-1.5 text-left font-semibold">Program</th>
                        <th className="hidden pb-1.5 text-left font-semibold md:table-cell">Program ID</th>
                        <th className="pb-1.5 text-right font-semibold">Requests</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-low">
                      {analytics.top_programs.map((program, i) => {
                        const maxTotal = analytics.top_programs[0].total
                        const pct = maxTotal ? (program.total / maxTotal) * 100 : 0
                        return (
                          <tr key={program.project_id} className="transition-colors duration-150 hover:bg-sand-50">
                            <td className="py-1.5 pr-3 font-mono text-xs text-sand-1100">{i + 1}</td>
                            <td className="py-1.5 pr-4">
                              <div className="min-w-[140px]">
                                <p className="truncate text-sm font-semibold text-sand-1600">{program.name ?? program.project_id}</p>
                                <div className="mt-1 h-1 max-w-[140px] overflow-hidden bg-sand-200">
                                  <div className="h-full bg-sand-1600" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            </td>
                            <td className="hidden py-1.5 pr-4 md:table-cell">
                              <span className="font-mono text-xs text-sand-1100">{shortId(program.project_id)}</span>
                            </td>
                            <td className="py-1.5 text-right font-mono font-semibold tabular-nums text-sand-1600">
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
            </Card>
          </section>
        </>
      )}
    </div>
  )
}
