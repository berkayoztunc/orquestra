import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Braces, FileText, Network } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { useAnalyticsStore } from '../store/analytics'
import { getGitHubLoginUrl } from '../api/client'
import TwitterWall from '../components/TwitterWall'
import TryItPanel from '../components/TryItPanel'
import VideoShowcase from '../components/VideoShowcase'
import RestBuildCard from '../components/RestBuildCard'
import AgentSetupCard from '../components/AgentSetupCard'
import { buttonClassName } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { Section } from '@/ui/Section'
import { HeroDecor } from '@/ui/HeroDecor'

const proofStats = [
  { value: '30s', label: 'IDL to hosted API' },
  // 11 tools in the main Orquestra MCP server + 7 in the Flow Engine MCP
  // server (services/analytics.ts's MCP_TOOL enum, ids 0-17) = 18 total.
  { value: '18', label: 'MCP tools for agents' },
  { value: '0', label: 'client SDKs required' },
]

function Chip({ children, strong = false }: { children: React.ReactNode; strong?: boolean }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center border px-2 py-1 font-mono text-[11px] ${
        strong ? 'border-sand-1500 bg-sand-1600 text-sand-50' : 'border-border-low bg-sand-50 text-sand-1400'
      }`}
    >
      {children}
    </span>
  )
}

const workflow: Array<{
  step: string
  title: string
  desc: string
  icon: typeof FileText
  detail: JSX.Element
}> = [
  {
    step: '01',
    title: 'Add a program',
    desc: 'Enter a program ID. If it already publishes its IDL on-chain, Orquestra imports and verifies it. If not, we show how to publish it, or you can upload it as an unverified manual IDL.',
    icon: FileText,
    detail: (
      <div className="space-y-1.5 font-mono text-[11px] leading-5 text-sand-1400">
        <p className="flex items-center justify-between gap-2 border border-border-low bg-sand-50 px-2 py-1.5">
          <span className="text-sand-1100">program</span>
          <span className="text-sand-1600">7xKp…9Qz</span>
        </p>
        <p className="flex items-center gap-1.5 text-sand-1600">
          <span aria-hidden="true">✓</span> on-chain IDL found · verified
        </p>
        <p className="text-sand-1100">no on-chain IDL? publish it, or upload manually</p>
      </div>
    ),
  },
  {
    step: '02',
    title: 'Generate surfaces',
    desc: 'Every instruction, account, error and PDA becomes REST endpoints, AI-ready docs, MCP tools and a transaction builder. Legacy by default, v0 or Transaction v1 when you ask.',
    icon: Braces,
    detail: (
      <div className="flex flex-wrap gap-1.5">
        <Chip>REST</Chip>
        <Chip>llms.txt</Chip>
        <Chip>MCP</Chip>
        <Chip>PDA</Chip>
        <Chip strong>legacy · v0 · v1</Chip>
      </div>
    ),
  },
  {
    step: '03',
    title: 'Connect apps + agents',
    desc: 'Backends and mobile apps call HTTP. Claude, Grok, Cursor and other agents use MCP, scoped to the programs you choose. Orquestra builds the transaction; you sign it.',
    icon: Network,
    detail: (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <Chip>curl</Chip>
          <Chip>Claude</Chip>
          <Chip>Grok</Chip>
          <Chip>Cursor</Chip>
          <Chip>mobile</Chip>
        </div>
        <p className="border border-border-low bg-sand-50 px-2 py-1.5 font-mono text-[11px] text-sand-1400">
          X-Scope-Key: <span className="text-sand-1100">sk_…</span>
        </p>
      </div>
    ),
  },
]

type SurfaceVisual = 'api' | 'mcp' | 'docs' | 'pda'

const capabilities: Array<{
  visual: SurfaceVisual
  title: string
  eyebrow: string
  desc: string
  code: string
}> = [
  {
    visual: 'api',
    title: 'Hosted API',
    eyebrow: 'Backend teams',
    desc: 'Call indexed Anchor instructions with JSON while Orquestra handles Borsh layouts, discriminators, and serialization.',
    code: 'POST /api/<project>/instructions/deposit/build',
  },
  {
    visual: 'mcp',
    title: 'MCP registry',
    eyebrow: 'AI agents',
    desc: 'Expose search, docs, PDA derivation, account reads, simulation, and transaction building to agent clients.',
    code: 'build_instruction({ program, instruction, args })',
  },
  {
    visual: 'docs',
    title: 'AI-ready docs',
    eyebrow: 'Context windows',
    desc: 'Generate compact Markdown from IDLs so humans and agents understand accounts, args, and errors quickly.',
    code: 'GET /project/<program>/llms.txt',
  },
  {
    visual: 'pda',
    title: 'PDA + account data',
    eyebrow: 'Integrations',
    desc: 'Derive addresses, fetch account data, and decode program state without shipping Solana tooling client-side.',
    code: 'derive_pda({ seeds, programId })',
  },
]

function CtaButtons(): JSX.Element {
  const { isAuthenticated } = useAuthStore()

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
      {isAuthenticated ? (
        <Link to="/dashboard" className={buttonClassName({ size: 'lg' })}>
          Go to dashboard
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : (
        <a href={getGitHubLoginUrl()} className={buttonClassName({ size: 'lg' })}>
          Start building
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
      )}
      <Link to="/explorer" className={buttonClassName({ variant: 'secondary', size: 'lg' })}>
        Browse programs
      </Link>
    </div>
  )
}

function SurfaceIllustration({ type }: { type: SurfaceVisual }): JSX.Element {
  const line = 'rgb(var(--rgb-sand-800))'
  const edge = 'rgb(var(--rgb-border-medium))'
  const grid = 'rgb(var(--rgb-border-low))'
  const ink = 'rgb(var(--rgb-sand-1500))'
  const muted = 'rgb(var(--rgb-sand-1100))'
  const paper = 'rgb(var(--rgb-sand-50))'
  const card = 'rgb(var(--rgb-sand-100))'
  const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'

  // Shared frame: faint dot grid + arrowhead marker, so all four illustrations read as one family.
  const Frame = ({ id, label, children }: { id: string; label: string; children: React.ReactNode }) => (
    <svg viewBox="0 0 560 260" className="h-full w-full" role="img" aria-label={label}>
      <defs>
        <pattern id={`${id}-dots`} width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill={grid} />
        </pattern>
        <marker id={`${id}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0.5L7.5 4L0 7.5z" fill={line} />
        </marker>
      </defs>
      <rect width="560" height="260" fill={`url(#${id}-dots)`} opacity="0.7" />
      {children}
    </svg>
  )

  const Label = ({ x, y, children, anchor = 'middle', size = 10, fill = muted, weight = 500 }: {
    x: number; y: number; children: React.ReactNode; anchor?: 'start' | 'middle' | 'end'; size?: number; fill?: string; weight?: number
  }) => (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} fontFamily={mono} fill={fill} fontWeight={weight} letterSpacing="0.4">
      {children}
    </text>
  )

  if (type === 'api') {
    const routes = [
      { y: 80, text: 'GET /instructions' },
      { y: 122, text: 'GET /pda' },
      { y: 164, text: 'POST /build', hot: true },
    ]
    return (
      <Frame id="api" label="Hosted API: a client sends JSON and receives an unsigned transaction">
        {/* client */}
        <rect x="24" y="92" width="112" height="76" rx="10" fill={paper} stroke={edge} />
        <Label x={80} y={118} size={10}>CLIENT</Label>
        <Label x={80} y={140} size={12} fill={ink} weight={700}>curl / app</Label>
        <Label x={80} y={156} size={10}>JSON over HTTPS</Label>

        <path d="M136 130H196" stroke={line} strokeWidth="1.5" markerEnd="url(#api-arrow)" />

        {/* api */}
        <rect x="200" y="30" width="160" height="200" rx="12" fill={paper} stroke={line} strokeWidth="1.5" />
        <path d="M200 42a12 12 0 0 1 12-12h136a12 12 0 0 1 12 12v18H200z" fill={ink} />
        <Label x={280} y={50} size={11} fill={paper} weight={700}>HOSTED API</Label>
        {routes.map((r) => (
          <g key={r.text}>
            <rect x="214" y={r.y} width="132" height="30" rx="8" fill={r.hot ? card : paper} stroke={r.hot ? line : edge} strokeWidth={r.hot ? 1.5 : 1} />
            <circle cx="228" cy={r.y + 15} r="3" fill={r.hot ? ink : edge} />
            <Label x={237} y={r.y + 18.5} anchor="start" size={9.5} fill={r.hot ? ink : muted} weight={r.hot ? 700 : 500}>{r.text}</Label>
          </g>
        ))}
        <Label x={280} y={212} size={10}>no SDK needed</Label>

        <path d="M360 130H420" stroke={line} strokeWidth="1.5" markerEnd="url(#api-arrow)" />

        {/* output */}
        <rect x="424" y="92" width="112" height="76" rx="10" fill={paper} stroke={edge} />
        <Label x={480} y={118} size={10}>RESPONSE</Label>
        <Label x={480} y={140} size={12} fill={ink} weight={700}>unsigned tx</Label>
        <Label x={480} y={156} size={10}>base58 / base64</Label>
      </Frame>
    )
  }

  if (type === 'mcp') {
    const tools = [
      { y: 40, text: 'search_programs' },
      { y: 88, text: 'read_llms_txt' },
      { y: 136, text: 'derive_pda' },
      { y: 184, text: 'build_instruction' },
    ]
    return (
      <Frame id="mcp" label="MCP registry: Claude, Codex and Grok call Orquestra tools">
        {/* clients */}
        {[
          { y: 28, src: '/brand/integrations/claude-color.svg', name: 'Claude' },
          { y: 102, src: '/brand/integrations/codex.svg', name: 'Codex' },
          { y: 176, src: '', name: 'Grok' },
        ].map((c) => (
          <g key={c.name}>
            <rect x="24" y={c.y} width="120" height="56" rx="10" fill={paper} stroke={edge} />
            {c.src ? (
              <image href={c.src} x="38" y={c.y + 14} width="28" height="28" preserveAspectRatio="xMidYMid meet" />
            ) : (
              <g>
                <rect x="38" y={c.y + 14} width="28" height="28" rx="7" fill={ink} />
                <Label x={52} y={c.y + 33} size={14} fill={paper} weight={700}>G</Label>
              </g>
            )}
            <Label x={78} y={c.y + 33} anchor="start" size={12} fill={ink} weight={700}>{c.name}</Label>
          </g>
        ))}
        <path d="M144 56H176V130M144 204H176V130" fill="none" stroke={line} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M144 130H206" fill="none" stroke={line} strokeWidth="1.5" markerEnd="url(#mcp-arrow)" />
        <circle cx="176" cy="130" r="3" fill={line} />

        {/* registry */}
        <rect x="210" y="92" width="136" height="76" rx="12" fill={ink} />
        <Label x={278} y={124} size={18} fill={paper} weight={700}>MCP</Label>
        <Label x={278} y={146} size={10} fill={paper}>registry · /mcp</Label>

        {/* tools bus */}
        <path d="M346 130H376M376 58V202" fill="none" stroke={line} strokeWidth="1.5" />
        {tools.map((t) => (
          <g key={t.text}>
            <path d={`M376 ${t.y + 18}H396`} stroke={line} strokeWidth="1.5" markerEnd="url(#mcp-arrow)" />
            <rect x="400" y={t.y} width="144" height="36" rx="18" fill={paper} stroke={edge} />
            <circle cx="417" cy={t.y + 18} r="3.5" fill={ink} />
            <Label x={428} y={t.y + 21.5} anchor="start" size={10} fill={ink}>{t.text}</Label>
          </g>
        ))}
      </Frame>
    )
  }

  if (type === 'docs') {
    const files = [
      { y: 34, name: 'llms.txt', note: 'agent-readable summary' },
      { y: 104, name: 'docs.md', note: 'human + AI markdown' },
      { y: 174, name: 'schema.json', note: 'typed instructions & accounts' },
    ]
    return (
      <Frame id="docs" label="AI-ready documents generated from one IDL">
        {/* source */}
        <rect x="24" y="92" width="104" height="76" rx="10" fill={ink} />
        <Label x={76} y={122} size={20} fill={paper} weight={700}>{'{ }'}</Label>
        <Label x={76} y={146} size={11} fill={paper} weight={700}>IDL</Label>

        <path d="M128 130H164M164 60V200" fill="none" stroke={line} strokeWidth="1.5" />
        {files.map((f) => (
          <g key={f.name}>
            <path d={`M164 ${f.y + 26}H196`} stroke={line} strokeWidth="1.5" markerEnd="url(#docs-arrow)" />
            <rect x="200" y={f.y} width="336" height="52" rx="10" fill={paper} stroke={edge} />
            {/* file icon */}
            <path d={`M218 ${f.y + 12}h14l8 8v20h-22z`} fill={card} stroke={line} strokeWidth="1.4" strokeLinejoin="round" />
            <path d={`M232 ${f.y + 12}v8h8`} fill="none" stroke={line} strokeWidth="1.4" strokeLinejoin="round" />
            <Label x={252} y={f.y + 23} anchor="start" size={12} fill={ink} weight={700}>{f.name}</Label>
            <Label x={252} y={f.y + 39} anchor="start" size={10}>{f.note}</Label>
            <circle cx="512" cy={f.y + 26} r="9" fill="none" stroke={line} strokeWidth="1.4" />
            <path d={`M507.5 ${f.y + 26}l3.2 3.2 5.8-6.4`} fill="none" stroke={line} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ))}
      </Frame>
    )
  }

  // pda
  return (
    <Frame id="pda" label="PDA derivation and decoded account data">
      {/* seeds */}
      <rect x="24" y="52" width="124" height="132" rx="10" fill={paper} stroke={edge} />
      <Label x={86} y={74} size={10}>SEEDS</Label>
      {['program id', '"vault"', 'user pubkey'].map((s, i) => (
        <g key={s}>
          <rect x="36" y={86 + i * 32} width="100" height="24" rx="12" fill={card} stroke={edge} />
          <Label x={86} y={102 + i * 32} size={10} fill={ink}>{s}</Label>
        </g>
      ))}

      <path d="M148 118H208" stroke={line} strokeWidth="1.5" markerEnd="url(#pda-arrow)" />
      <Label x={178} y={108} size={10}>derive</Label>

      {/* PDA */}
      <rect x="212" y="78" width="136" height="80" rx="12" fill={ink} />
      <Label x={280} y={106} size={10} fill={paper}>PDA</Label>
      <Label x={280} y={128} size={13} fill={paper} weight={700}>7xKp…9Qz</Label>
      <Label x={280} y={146} size={10} fill={paper}>bump 254</Label>

      <path d="M348 118H408" stroke={line} strokeWidth="1.5" markerEnd="url(#pda-arrow)" />
      <Label x={378} y={108} size={10}>fetch</Label>

      {/* account */}
      <rect x="412" y="52" width="124" height="132" rx="10" fill={paper} stroke={line} strokeWidth="1.5" />
      <Label x={474} y={74} size={10}>ACCOUNT DATA</Label>
      {[
        ['owner', '9wQ…c1'],
        ['amount', '1,250'],
        ['bump', '254'],
      ].map(([k, v], i) => (
        <g key={k}>
          <rect x="424" y={86 + i * 32} width="100" height="24" rx="6" fill={card} stroke={edge} />
          <Label x={434} y={102 + i * 32} anchor="start" size={10}>{k}</Label>
          <Label x={514} y={102 + i * 32} anchor="end" size={10} fill={ink} weight={700}>{v}</Label>
        </g>
      ))}

      <Label x={280} y={226} size={10}>derive_pda  →  fetch_pda_data</Label>
    </Frame>
  )
}

export default function Home(): JSX.Element {
  const { analytics, loadAnalytics } = useAnalyticsStore()

  useEffect(() => {
    loadAnalytics()
  }, [loadAnalytics])

  const programsWithIdl = analytics ? analytics.platform.catalog_programs_with_idl.toLocaleString() : '—'

  return (
    <div className="relative">
      {/* Hero — centered with hatch icon + animated pulse lines */}
      <section className="relative px-4 pb-20 pt-24 sm:pt-28">
        <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center text-center">
          <HeroDecor />
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight text-sand-1600 sm:text-5xl md:text-6xl lg:text-[64px] lg:leading-[1.05]">
            API and MCP layer 
            <br />
            for Solana programs.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-sand-1200 sm:text-lg">
            Orquestra converts Anchor programs into hosted REST endpoints, AI-ready docs, MCP tools,
            PDA resolution, and wallet-ready transactions.
          </p>
          <div className="mt-10">
            <CtaButtons />
          </div>

          <div className="mt-16 grid w-full max-w-2xl grid-cols-2 divide-x divide-y divide-border-low border-y border-border-low sm:grid-cols-4 sm:divide-y-0">
            {proofStats.map((stat) => (
              <div key={stat.label} className="px-4 py-5">
                <p className="font-mono text-2xl text-sand-1600">{stat.value}</p>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-sand-1100">
                  {stat.label}
                </p>
              </div>
            ))}
            <div className="px-4 py-5">
              <p className="font-mono text-2xl text-sand-1600">{programsWithIdl}</p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-sand-1100">
                programs with IDL
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Products section header */}
      <div className="border-t border-border-low" />

      <div className="space-y-24 px-6 py-20 sm:px-8">
        <Section
          eyebrow="Products"
          title="One IDL becomes the operating layer for apps and agents."
          align="center"
        >
          <div className="grid gap-px overflow-hidden border border-border-low bg-border-low md:grid-cols-3">
            {workflow.map((item) => {
              const Icon = item.icon
              return (
                <div
                  key={item.step}
                  className="group flex flex-col gap-6 bg-bg1 p-6 transition-colors hover:bg-sand-100"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">
                      {item.step}
                    </span>
                    <div
                      className="flex size-9 items-center justify-center border border-border-low bg-sand-50"
                      style={{
                        backgroundImage:
                          'repeating-linear-gradient(-45deg, transparent, transparent 4px, rgb(var(--rgb-border-low) / 0.7) 4px, rgb(var(--rgb-border-low) / 0.7) 5px)',
                      }}
                    >
                      <Icon className="size-4 text-sand-1500" aria-hidden="true" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-sand-1600">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-sand-1200">{item.desc}</p>
                  </div>
                  <div className="mt-auto border-t border-border-low pt-4">{item.detail}</div>
                </div>
              )
            })}
          </div>
        </Section>

        <Section
          eyebrow="Platform surfaces"
          title="One source of truth. Four production interfaces."
        >
          <div className="grid gap-px overflow-hidden border border-border-low bg-border-low sm:grid-cols-2">
            {capabilities.map((capability) => (
              <div
                key={capability.title}
                className="flex min-h-[520px] flex-col bg-bg1 transition-colors hover:bg-sand-100"
              >
                <div className="h-64 overflow-hidden border-b border-border-low bg-sand-50">
                  <SurfaceIllustration type={capability.visual} />
                </div>
                <div className="flex flex-1 flex-col gap-3 p-6">
                  <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">
                    {capability.eyebrow}
                  </p>
                  <h3 className="text-lg font-semibold text-sand-1600">{capability.title}</h3>
                  <p className="text-sm leading-6 text-sand-1200">{capability.desc}</p>
                  <code className="mt-auto block overflow-hidden text-ellipsis whitespace-nowrap border border-border-low bg-sand-100 px-3 py-2 font-mono text-xs text-sand-1500">
                    {capability.code}
                  </code>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <section className="grid min-w-0 gap-5 lg:grid-cols-2">
          <RestBuildCard />
          <AgentSetupCard />
        </section>

        <Section eyebrow="Watch" title="See Orquestra in action.">
          <VideoShowcase />
        </Section>

        <Section eyebrow="Live proof" title="Build a real transaction at edge speed.">
          <Card className="p-5 md:p-6" tone="default">
            <TryItPanel />
          </Card>
        </Section>

        <Section
          eyebrow="Builder signal"
          title="Built for teams shipping Solana integrations."
          align="center"
        >
          <TwitterWall />
        </Section>
      </div>
    </div>
  )
}
