import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useAnalyticsStore } from '@/store/analytics'
import type { DailyApiEntry, DailyMcpEntry } from '@/api/client'
import { Card } from '@/ui/Card'
import { Button } from '@/ui/Button'

// ─── Constants ───────────────────────────────────────────────────────────────

const MCP_TOOL_NAMES: Record<number, string> = {
  0: 'search_programs',
  1: 'list_instructions',
  2: 'build_instruction',
  3: 'list_pda_accounts',
  4: 'derive_pda',
  5: 'read_llms_txt',
  6: 'get_ai_analysis',
  7: 'fetch_pda_data',
  8: 'simulate_instruction',
  9: 'get_program_data',
  10: 'simulate_transaction',
  11: 'get_flow_schema',
  12: 'validate_flow',
  13: 'simulate_flow',
  14: 'publish_flow',
  15: 'list_flows',
  16: 'get_flow_metadata',
  17: 'estimate_flow',
}
const MAIN_TOOL_IDS = Array.from({ length: 11 }, (_, i) => i)
const FLOW_TOOL_IDS = Array.from({ length: 7 }, (_, i) => i + 11)

const COLORS = {
  api: 'rgb(var(--rgb-sand-1600))',
  mcp: '#b75000',
} as const

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── Helpers ─────────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat('en-US')
const fmt = (n: number): string => nf.format(Math.round(n))
const compact = (n: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

function intToDate(d: number): Date {
  const s = String(d)
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)))
}
function dateToInt(d: Date): number {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}
const longDate = (d: Date): string =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function pct(n: number, total: number, decimals = 0): string {
  if (!total) return '0%'
  const v = (n / total) * 100
  return `${decimals ? v.toFixed(decimals) : Math.round(v)}%`
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value
}

/** Sum of the last `n` values vs the `n` before them. */
function trend(values: number[], n = 7): { current: number; previous: number; delta: number | null } {
  const current = values.slice(-n).reduce((s, v) => s + v, 0)
  const previous = values.slice(-2 * n, -n).reduce((s, v) => s + v, 0)
  return { current, previous, delta: previous > 0 ? ((current - previous) / previous) * 100 : null }
}

// ─── Small UI pieces ─────────────────────────────────────────────────────────

function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }): JSX.Element {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-sand-1100">{children}</h2>
      {right}
    </div>
  )
}

function Delta({ value }: { value: number | null }): JSX.Element {
  if (value === null) return <span className="font-mono text-[11px] text-sand-1000">new</span>
  const up = value >= 0
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold ${up ? 'text-emerald-600' : 'text-red-500'}`}
      title="Last 7 days vs the 7 days before"
    >
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      {Math.abs(value).toFixed(value > 99 || value < -99 ? 0 : 1)}%
    </span>
  )
}

function Skeleton({ className = '' }: { className?: string }): JSX.Element {
  return <div className={`bg-sand-200 motion-safe:animate-pulse ${className}`} />
}

function Sparkline({ data, color, height = 36 }: { data: number[]; color: string; height?: number }): JSX.Element {
  if (data.length < 2) return <div style={{ height }} />
  const max = Math.max(...data, 1)
  const w = 100
  const step = w / (data.length - 1)
  const pts = data.map((v, i) => [i * step, height - 3 - (v / max) * (height - 8)] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
  const area = `${line} L${w} ${height} L0 ${height} Z`
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden="true">
      <path d={area} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

function KpiCard({
  label,
  value,
  sub,
  delta,
  spark,
  color,
  hint,
  loading,
}: {
  label: string
  value: string
  sub?: string
  delta?: number | null
  spark?: number[]
  color?: string
  hint?: string
  loading?: boolean
}): JSX.Element {
  if (loading) {
    return (
      <div className="border border-border-low bg-bg1 p-4">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="mt-3 h-8 w-28" />
        <Skeleton className="mt-4 h-8 w-full" />
      </div>
    )
  }
  return (
    <div className="flex flex-col border border-border-low bg-bg1 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="truncate font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-sand-1100">{label}</p>
        {delta !== undefined && <Delta value={delta} />}
      </div>
      <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-sand-1600">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-sand-1100">{sub}</p>}
      {spark && color && (
        <div className="mt-3">
          <Sparkline data={spark} color={color} />
        </div>
      )}
      {hint && !spark && <p className="mt-auto pt-3 text-[11px] text-sand-1000">{hint}</p>}
    </div>
  )
}

function EmptyState({ title, desc }: { title: string; desc: string }): JSX.Element {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center border border-dashed border-border-low bg-sand-50 px-4 py-4 text-center">
      <p className="text-sm font-semibold text-sand-1600">{title}</p>
      <p className="mt-0.5 max-w-sm text-xs leading-5 text-sand-1200">{desc}</p>
    </div>
  )
}

// ─── Charts ──────────────────────────────────────────────────────────────────

interface Series {
  name: string
  color: string
  data: number[]
}

/** Two-series area chart with a hover crosshair. API and MCP share one time axis. */
function TrafficChart({ dates, series, height = 220 }: { dates: Date[]; series: Series[]; height?: number }): JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  // Draw in real pixels so axis text stays readable on phones instead of scaling down with the viewBox.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(640)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setW(Math.max(280, Math.round(el.getBoundingClientRect().width)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const padL = 36
  const padR = 8
  const padT = 10
  const padB = 22
  const n = dates.length
  if (n < 2) return <EmptyState title="No chart data yet" desc="Requests appear here after API or MCP traffic arrives." />

  const max = Math.max(...series.flatMap((s) => s.data), 1)
  const niceMax = Math.ceil(max / 10 ** Math.floor(Math.log10(max))) * 10 ** Math.floor(Math.log10(max))
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR)
  const y = (v: number) => padT + (1 - v / niceMax) * (height - padT - padB)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * niceMax)
  const labelStep = Math.max(1, Math.ceil(n / (W < 420 ? 4 : 7)))

  const pathFor = (data: number[]) => data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')

  return (
    <div ref={wrapRef} className="relative select-none">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        width={W}
        height={height}
        className="block max-w-full"
        role="img"
        aria-label="Daily API requests and MCP tool calls"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const rel = ((e.clientX - rect.left) / rect.width) * W
          const idx = Math.round(((rel - padL) / (W - padL - padR)) * (n - 1))
          setHover(Math.max(0, Math.min(n - 1, idx)))
        }}
      >
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.name} id={`area-${i}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="rgb(var(--rgb-border-low))" strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="rgb(var(--rgb-sand-1000))" fontFamily="monospace">
              {compact(t)}
            </text>
          </g>
        ))}
        {dates.map((d, i) =>
          i % labelStep === 0 ? (
            <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill="rgb(var(--rgb-sand-1000))" fontFamily="monospace">
              {longDate(d)}
            </text>
          ) : null,
        )}
        {series.map((s, i) => (
          <g key={s.name}>
            <path d={`${pathFor(s.data)} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill={`url(#area-${i})`} />
            <path d={pathFor(s.data)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={height - padB} stroke="rgb(var(--rgb-sand-800))" strokeDasharray="3 3" />
            {series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.data[hover])} r="3.5" fill="rgb(var(--rgb-sand-50))" stroke={s.color} strokeWidth="2" />
            ))}
          </g>
        )}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-[150px] border border-border-medium bg-bg1 px-3 py-2 text-xs shadow-lg"
          style={{ left: `clamp(0px, calc(${(x(hover) / W) * 100}% - 75px), calc(100% - 156px))` }}
        >
          <p className="font-mono text-[11px] text-sand-1100">{longDate(dates[hover])}</p>
          {series.map((s) => (
            <p key={s.name} className="mt-1 flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-sand-1200">
                <span className="inline-block size-2" style={{ background: s.color }} />
                {s.name}
              </span>
              <span className="font-mono font-semibold text-sand-1600">{fmt(s.data[hover])}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/** GitHub-style calendar of the last weeks of API traffic. */
function ActivityCalendar({ dates, values }: { dates: Date[]; values: number[] }): JSX.Element {
  if (dates.length === 0) return <EmptyState title="No activity yet" desc="Daily traffic will appear here." />
  const max = Math.max(...values, 1)
  const firstDow = dates[0].getUTCDay()
  const cells: Array<{ date: Date; value: number } | null> = [
    ...Array.from({ length: firstDow }, () => null),
    ...dates.map((date, i) => ({ date, value: values[i] })),
  ]
  const weeks: Array<typeof cells> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return (
    <div className="flex gap-1.5">
      <div className="flex flex-col justify-between py-0.5 pr-1 font-mono text-[9px] text-sand-1000">
        {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((d, i) => (
          <span key={i} className="h-4 leading-4">
            {d}
          </span>
        ))}
      </div>
      <div className="flex flex-1 gap-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-1 flex-col gap-1">
            {Array.from({ length: 7 }, (_, di) => {
              const cell = week[di]
              if (!cell) return <div key={di} className="h-4" />
              const level = cell.value === 0 ? 0 : Math.max(1, Math.ceil((cell.value / max) * 4))
              const opacity = [0, 0.18, 0.38, 0.62, 0.95][level]
              return (
                <div
                  key={di}
                  className="h-4 border border-border-low"
                  style={{ background: level ? `rgb(var(--rgb-sand-1600) / ${opacity})` : undefined }}
                  title={`${longDate(cell.date)} · ${fmt(cell.value)} requests`}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function WeekdayBars({ avg }: { avg: number[] }): JSX.Element {
  const max = Math.max(...avg, 1)
  const best = avg.indexOf(Math.max(...avg))
  return (
    <div className="flex h-28 items-end gap-2">
      {avg.map((v, i) => (
        <div key={WEEKDAYS[i]} className="flex flex-1 flex-col items-center gap-1.5">
          <span className="font-mono text-[10px] text-sand-1100">{compact(v)}</span>
          <div className="flex h-16 w-full items-end">
            <div
              className="w-full bg-sand-1600 motion-safe:transition-[height] motion-safe:duration-300"
              style={{ height: `${Math.max(4, (v / max) * 100)}%`, opacity: i === best ? 1 : 0.35 }}
            />
          </div>
          <span className={`font-mono text-[10px] ${i === best ? 'font-bold text-sand-1600' : 'text-sand-1100'}`}>{WEEKDAYS[i]}</span>
        </div>
      ))}
    </div>
  )
}

function FunnelRow({ label, value, total, note, strong }: { label: string; value: number; total: number; note?: string; strong?: boolean }): JSX.Element {
  const width = total ? Math.max(1.5, (value / total) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
        <span className={strong ? 'font-semibold text-sand-1600' : 'text-sand-1300'}>{label}</span>
        <span className="font-mono text-sand-1200">
          {fmt(value)} <span className="text-sand-1000">· {pct(value, total, value / (total || 1) < 0.01 ? 2 : 1)}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden bg-sand-200">
        <div className="h-full bg-sand-1600 motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${width}%`, opacity: strong ? 1 : 0.55 }} />
      </div>
      {note && <p className="mt-1 text-[11px] text-sand-1000">{note}</p>}
    </div>
  )
}

function ToolList({ title, ids, counts, total }: { title: string; ids: number[]; counts: Map<number, number>; total: number }): JSX.Element {
  const rows = ids.map((id) => ({ id, count: counts.get(id) ?? 0 })).sort((a, b) => b.count - a.count)
  const max = Math.max(...rows.map((r) => r.count), 1)
  return (
    <div>
      <p className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">
        <span>{title}</span>
        <span>{fmt(rows.reduce((s, r) => s + r.count, 0))} calls</span>
      </p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className={r.count === 0 ? 'opacity-45' : ''}>
            <div className="mb-0.5 flex items-center justify-between gap-3">
              <code className="truncate font-mono text-xs text-sand-1500">{MCP_TOOL_NAMES[r.id] ?? `tool_${r.id}`}</code>
              <span className="font-mono text-[11px] text-sand-1200">
                {fmt(r.count)} <span className="text-sand-1000">· {pct(r.count, total)}</span>
              </span>
            </div>
            <div className="h-1 overflow-hidden bg-sand-200">
              <div className="h-full" style={{ width: `${(r.count / max) * 100}%`, background: COLORS.mcp }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Insight({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="border border-border-low bg-sand-50 px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-sand-1000">{label}</p>
      <p className="mt-1 truncate font-mono text-base font-semibold text-sand-1600">{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-sand-1100">{sub}</p>}
    </div>
  )
}

function RefreshIcon(): JSX.Element {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Analytics(): JSX.Element {
  const { stats, analytics, isLoadingStats, isLoadingAnalytics, error, loadStats, loadAnalytics } = useAnalyticsStore()
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  useEffect(() => {
    Promise.all([loadStats(), loadAnalytics()]).then(() => setUpdatedAt(new Date()))
  }, [loadStats, loadAnalytics])

  // One continuous day axis (missing days = 0) shared by API and MCP.
  const model = useMemo(() => {
    if (!analytics) return null
    const apiMap = new Map<number, number>(analytics.daily_api.map((d: DailyApiEntry) => [d.date, d.total]))
    const mcpMap = new Map<number, number>()
    const toolCounts = new Map<number, number>()
    for (const d of analytics.daily_mcp as DailyMcpEntry[]) {
      mcpMap.set(d.date, (mcpMap.get(d.date) ?? 0) + d.total)
      toolCounts.set(d.tool_id, (toolCounts.get(d.tool_id) ?? 0) + d.total)
    }
    const all = [...apiMap.keys(), ...mcpMap.keys()]
    if (all.length === 0) return { dates: [] as Date[], api: [] as number[], mcp: [] as number[], toolCounts }
    const start = intToDate(Math.min(...all))
    const end = intToDate(Math.max(...all))
    const dates: Date[] = []
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86_400_000)) dates.push(new Date(d))
    const api = dates.map((d) => apiMap.get(dateToInt(d)) ?? 0)
    const mcp = dates.map((d) => mcpMap.get(dateToInt(d)) ?? 0)
    return { dates, api, mcp, toolCounts }
  }, [analytics])

  const derived = useMemo(() => {
    if (!model || model.dates.length === 0) return null
    const { dates, api, mcp, toolCounts } = model
    const api30 = api.reduce((s, v) => s + v, 0)
    const mcp30 = mcp.reduce((s, v) => s + v, 0)
    const peakIdx = api.indexOf(Math.max(...api))
    const activeDays = api.filter((v) => v > 0).length
    const weekdaySums = Array(7).fill(0) as number[]
    const weekdayCounts = Array(7).fill(0) as number[]
    dates.forEach((d, i) => {
      weekdaySums[d.getUTCDay()] += api[i]
      weekdayCounts[d.getUTCDay()] += 1
    })
    const weekdayAvg = weekdaySums.map((s, i) => (weekdayCounts[i] ? s / weekdayCounts[i] : 0))
    const toolTotal = [...toolCounts.values()].reduce((s, v) => s + v, 0)
    const topTool = [...toolCounts.entries()].sort(([, a], [, b]) => b - a)[0]
    const todayInt = dateToInt(new Date())
    const todayIdx = dates.findIndex((d) => dateToInt(d) === todayInt)
    return {
      api30,
      mcp30,
      avgPerDay: api30 / dates.length,
      peak: { date: dates[peakIdx], value: api[peakIdx] },
      activeDays,
      weekdayAvg,
      weekdayBest: WEEKDAYS[weekdayAvg.indexOf(Math.max(...weekdayAvg))],
      apiTrend: trend(api),
      mcpTrend: trend(mcp),
      mcpShare: api30 + mcp30 ? (mcp30 / (api30 + mcp30)) * 100 : 0,
      toolTotal,
      topTool,
      activeTools: [...toolCounts.values()].filter((v) => v > 0).length,
      todayApi: todayIdx >= 0 ? api[todayIdx] : 0,
      todayMcp: todayIdx >= 0 ? mcp[todayIdx] : 0,
    }
  }, [model])

  const platform = analytics?.platform
  const loading = isLoadingAnalytics && !analytics
  const topTotal = analytics?.top_programs.reduce((s, p) => s + p.total, 0) ?? 0

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 px-6 py-6 sm:px-8 sm:py-8">
      {/* Header */}
      <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="mb-2 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-sand-1100">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            Live · last 30 days
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-sand-1600 md:text-3xl">Analytics</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-sand-1200">
            How apps and AI agents use Orquestra: API traffic, MCP tool demand, the programs people build against, and how much of Solana we cover.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {updatedAt && (
            <span className="hidden font-mono text-[11px] text-sand-1000 sm:inline">
              Updated {updatedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              Promise.all([loadStats(), loadAnalytics()]).then(() => setUpdatedAt(new Date()))
            }}
          >
            <RefreshIcon />
            Refresh
          </Button>
        </div>
      </section>

      {error && (
        <div className="border border-[#b75000]/20 bg-[#b75000]/5 p-3 text-sm" role="alert">
          <p className="font-semibold text-[#b75000]">Analytics failed to load</p>
          <p className="mt-1 text-[#b75000]/80">{error}</p>
        </div>
      )}

      {/* KPI strip */}
      <section aria-label="Key metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="API requests · 30d"
          value={derived ? compact(derived.api30) : '–'}
          sub={derived ? `${fmt(derived.avgPerDay)} per day on average` : undefined}
          delta={derived?.apiTrend.delta}
          spark={model?.api}
          color={COLORS.api}
          loading={loading}
        />
        <KpiCard
          label="MCP calls · 30d"
          value={derived ? compact(derived.mcp30) : '–'}
          sub={derived ? `${derived.activeTools} of 18 tools used` : undefined}
          delta={derived?.mcpTrend.delta}
          spark={model?.mcp}
          color={COLORS.mcp}
          loading={loading}
        />
        <KpiCard
          label="Programs in catalog"
          value={stats ? fmt(stats.total_projects) : '–'}
          sub={platform ? `${fmt(platform.idl_versions_total)} IDL versions stored` : undefined}
          hint="Public programs with an IDL"
          loading={isLoadingStats && !stats}
        />
        <KpiCard
          label="Users"
          value={stats ? fmt(stats.total_users) : '–'}
          sub={platform ? `${fmt(platform.workflow_runs_total)} workflow runs` : undefined}
          hint="Signed in with GitHub"
          loading={isLoadingStats && !stats}
        />
      </section>

      {/* All-time totals: every counter in one place, full numbers */}
      <section aria-label="All-time totals">
        <SectionLabel right={<span className="font-mono text-[11px] text-sand-1000">since launch</span>}>Totals</SectionLabel>
        <div className="grid grid-cols-2 gap-px overflow-hidden border border-border-low bg-border-low lg:grid-cols-5">
          {(
            [
              { label: 'API requests', value: analytics?.totals_alltime.api, accent: COLORS.api },
              { label: 'MCP calls', value: analytics?.totals_alltime.mcp, accent: COLORS.mcp },
              {
                label: 'All traffic',
                value: analytics ? analytics.totals_alltime.api + analytics.totals_alltime.mcp : undefined,
              },
              { label: 'Users', value: stats?.total_users },
              { label: 'Programs in catalog', value: stats?.total_projects },
              { label: 'Programs scanned', value: platform?.total_programs },
              { label: 'Programs with IDL', value: platform?.programs_with_idl },
              { label: 'Verified builds', value: platform?.verified_programs },
              { label: 'IDL versions', value: platform?.idl_versions_total },
              { label: 'Workflow runs', value: platform?.workflow_runs_total },
            ] as Array<{ label: string; value: number | undefined; accent?: string }>
          ).map((t) => (
            <div key={t.label} className="bg-bg1 px-4 py-3">
              <p className="flex min-h-[2.2em] items-start gap-1.5 font-mono text-[10px] uppercase leading-[1.1] tracking-[0.12em] text-sand-1000">
                {t.accent && <span className="mt-[0.2em] inline-block size-1.5 shrink-0" style={{ background: t.accent }} />}
                <span>{t.label}</span>
              </p>
              {t.value === undefined ? (
                <Skeleton className="mt-2 h-6 w-20" />
              ) : (
                <p className="mt-1 break-all font-mono text-lg font-semibold tabular-nums text-sand-1600 sm:text-xl" title={fmt(t.value)}>
                  {fmt(t.value)}
                </p>
              )}
            </div>
          ))}
        </div>
        {stats && (
          <p className="mt-2 font-mono text-[11px] text-sand-1000">
            + {fmt(stats.total_known_addresses)} known addresses annotated
          </p>
        )}
      </section>

      {derived && model && (
        <>
          {/* Traffic + today */}
          <section className="grid gap-3 xl:grid-cols-[2fr_1fr]">
            <Card className="p-4 sm:p-5">
              <SectionLabel
                right={
                  <span className="flex items-center gap-4 font-mono text-[11px] text-sand-1200">
                    <span className="flex items-center gap-1.5"><span className="inline-block size-2" style={{ background: COLORS.api }} />API</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block size-2" style={{ background: COLORS.mcp }} />MCP</span>
                  </span>
                }
              >
                Traffic
              </SectionLabel>
              <TrafficChart
                dates={model.dates}
                series={[
                  { name: 'API requests', color: COLORS.api, data: model.api },
                  { name: 'MCP calls', color: COLORS.mcp, data: model.mcp },
                ]}
              />
            </Card>

            <Card className="p-4 sm:p-5">
              <SectionLabel>Highlights</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                <Insight label="API today" value={fmt(derived.todayApi)} sub="requests" />
                <Insight label="MCP today" value={fmt(derived.todayMcp)} sub="tool calls" />
                <Insight label="Peak day" value={fmt(derived.peak.value)} sub={longDate(derived.peak.date)} />
                <Insight label="Busiest weekday" value={derived.weekdayBest} sub="highest daily average" />
                <Insight label="MCP share" value={`${derived.mcpShare.toFixed(1)}%`} sub="of all traffic" />
                <Insight label="Active days" value={`${derived.activeDays}/${model.dates.length}`} sub="with API traffic" />
                <Insight
                  label="Top MCP tool"
                  value={derived.topTool ? (MCP_TOOL_NAMES[derived.topTool[0]] ?? `tool_${derived.topTool[0]}`) : '–'}
                  sub={derived.topTool ? `${pct(derived.topTool[1], derived.toolTotal)} of calls` : undefined}
                />
                <Insight label="All-time" value={compact((analytics?.totals_alltime.api ?? 0) + (analytics?.totals_alltime.mcp ?? 0))} sub={`${compact(analytics?.totals_alltime.api ?? 0)} API · ${compact(analytics?.totals_alltime.mcp ?? 0)} MCP`} />
              </div>
            </Card>
          </section>

          {/* Rhythm */}
          <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <Card className="p-4 sm:p-5">
              <SectionLabel right={<span className="font-mono text-[11px] text-sand-1000">darker = busier</span>}>Daily activity</SectionLabel>
              <ActivityCalendar dates={model.dates} values={model.api} />
            </Card>
            <Card className="p-4 sm:p-5">
              <SectionLabel right={<span className="font-mono text-[11px] text-sand-1000">avg API requests</span>}>By weekday</SectionLabel>
              <WeekdayBars avg={derived.weekdayAvg} />
            </Card>
          </section>
        </>
      )}

      {loading && (
        <div className="grid gap-3 xl:grid-cols-[2fr_1fr]">
          <div className="border border-border-low bg-bg1 p-5"><Skeleton className="h-4 w-32" /><Skeleton className="mt-4 h-52 w-full" /></div>
          <div className="border border-border-low bg-bg1 p-5"><Skeleton className="h-4 w-24" /><Skeleton className="mt-4 h-52 w-full" /></div>
        </div>
      )}

      {analytics && (
        <>
          {/* Programs + coverage */}
          <section className="grid gap-3 xl:grid-cols-[1.3fr_1fr]">
            <Card className="p-4 sm:p-5">
              <SectionLabel right={<span className="font-mono text-[11px] text-sand-1000">API + MCP · all time</span>}>Top programs</SectionLabel>
              {analytics.top_programs.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border-low text-[10px] uppercase tracking-[0.14em] text-sand-1100">
                        <th className="pb-2 text-left font-semibold">#</th>
                        <th className="pb-2 text-left font-semibold">Program</th>
                        <th className="hidden pb-2 text-left font-semibold md:table-cell">Project ID</th>
                        <th className="pb-2 text-right font-semibold">Share</th>
                        <th className="pb-2 text-right font-semibold">Requests</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-low">
                      {analytics.top_programs.map((p, i) => {
                        const max = analytics.top_programs[0].total
                        return (
                          <tr key={p.project_id} className="transition-colors hover:bg-sand-50">
                            <td className="py-2.5 pr-3 font-mono text-xs text-sand-1100">{i + 1}</td>
                            <td className="py-2.5 pr-4">
                              <p className="truncate text-sm font-semibold text-sand-1600">{p.name ?? p.project_id}</p>
                              <div className="mt-1.5 h-1 max-w-[220px] overflow-hidden bg-sand-200">
                                <div className="h-full bg-sand-1600" style={{ width: `${max ? (p.total / max) * 100 : 0}%` }} />
                              </div>
                            </td>
                            <td className="hidden py-2.5 pr-4 md:table-cell">
                              <span className="font-mono text-xs text-sand-1100">{shortId(p.project_id)}</span>
                            </td>
                            <td className="py-2.5 pr-4 text-right font-mono text-xs text-sand-1200">{pct(p.total, topTotal)}</td>
                            <td className="py-2.5 text-right font-mono font-semibold tabular-nums text-sand-1600">{fmt(p.total)}</td>
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

            <Card className="p-4 sm:p-5">
              <SectionLabel right={<span className="font-mono text-[11px] text-sand-1000">of {platform ? fmt(platform.total_programs) : '–'} scanned</span>}>Coverage funnel</SectionLabel>
              {platform ? (
                <div className="space-y-4">
                  <FunnelRow label="Programs scanned" value={platform.total_programs} total={platform.total_programs} strong />
                  <FunnelRow label="Verified builds" value={platform.verified_programs} total={platform.total_programs} />
                  <FunnelRow label="With an IDL" value={platform.programs_with_idl} total={platform.total_programs} />
                  <FunnelRow label="IDL + verified" value={platform.programs_with_idl_and_verified} total={platform.total_programs} strong />
                  <div className="grid grid-cols-2 gap-2 border-t border-border-low pt-3">
                    <Insight label="Catalog with IDL" value={fmt(platform.catalog_programs_with_idl)} sub="usable via API/MCP" />
                    <Insight
                      label="Coverage gaps"
                      value={fmt(
                        Math.max(platform.verified_programs - platform.programs_with_idl_and_verified, 0) +
                          Math.max(platform.programs_with_idl - platform.programs_with_idl_and_verified, 0),
                      )}
                      sub="verified w/o IDL + IDL unverified"
                    />
                  </div>
                </div>
              ) : (
                <Skeleton className="h-52 w-full" />
              )}
            </Card>
          </section>

          {/* MCP tools: all of them, grouped */}
          <Card className="p-4 sm:p-5">
            <SectionLabel right={derived ? <span className="font-mono text-[11px] text-sand-1000">{fmt(derived.toolTotal)} calls · 30d</span> : undefined}>MCP tool demand</SectionLabel>
            {model && derived && derived.toolTotal > 0 ? (
              <div className="grid gap-6 md:grid-cols-2">
                <ToolList title="Orquestra MCP · 11 tools" ids={MAIN_TOOL_IDS} counts={model.toolCounts} total={derived.toolTotal} />
                <ToolList title="Flow Engine MCP · 7 tools" ids={FLOW_TOOL_IDS} counts={model.toolCounts} total={derived.toolTotal} />
              </div>
            ) : (
              <EmptyState title="No MCP calls yet" desc="Connect an AI agent through MCP to populate tool demand." />
            )}
          </Card>
        </>
      )}
    </div>
  )
}
