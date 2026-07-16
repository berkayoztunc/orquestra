import { Link } from 'react-router-dom'
import { ArrowRight, Braces, FileText, Network, ShieldCheck, Terminal } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { getGitHubLoginUrl } from '../api/client'
import CodeBlock from '../components/CodeBlock'
import TwitterWall from '../components/TwitterWall'
import TryItPanel from '../components/TryItPanel'
import { buttonClassName } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { Section } from '@/ui/Section'
import { HeroDecor } from '@/ui/HeroDecor'

const proofStats = [
  { value: '30s', label: 'IDL to hosted API' },
  { value: '9', label: 'MCP tools for agents' },
  { value: '0', label: 'client SDKs required' },
]

const workflow = [
  {
    step: '01',
    title: 'Upload IDL',
    desc: 'Anchor interfaces become indexed instructions, accounts, errors, PDAs, and typed args.',
    icon: FileText,
  },
  {
    step: '02',
    title: 'Generate surfaces',
    desc: 'Orquestra publishes REST endpoints, Markdown docs, MCP tools, and transaction builders.',
    icon: Braces,
  },
  {
    step: '03',
    title: 'Connect apps + agents',
    desc: 'Backends, mobile apps, Claude, Cursor, and agents call Solana programs through HTTP.',
    icon: Network,
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

const curlExample = `API=https://api.orquestra.dev

curl -X POST "$API/api/marinade/instructions/deposit/build" \\
  -H "Content-Type: application/json" \\
  -d '{
    "accounts": { "state": "8szGk...", "user": "9xTy..." },
    "args": { "lamports": 1000000000 },
    "network": "mainnet-beta"
  }'

# -> { "transaction": "AQAAAAAAAAAAAA..." }`

const mcpConfig = `{
  "mcpServers": {
    "orquestra": {
			"url": "https://api.orquestra.dev/mcp",
			"type": "http"
		}
  }
  //
}`

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
  const stroke = 'rgb(var(--rgb-sand-800))'
  const soft = 'rgb(var(--rgb-border-medium))'
  const faint = 'rgb(var(--rgb-border-low))'
  const ink = 'rgb(var(--rgb-sand-1500))'
  const paper = 'rgb(var(--rgb-sand-50))'

  if (type === 'api') {
    return (
      <svg viewBox="0 0 560 260" className="h-full w-full" role="img" aria-label="Hosted API diagram">
        <defs>
          <linearGradient id="apiFade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={paper} stopOpacity="0.2" />
            <stop offset="1" stopColor={paper} stopOpacity="1" />
          </linearGradient>
        </defs>
        <g fill="none" stroke={faint} strokeWidth="1">
          {[80, 170, 390, 480].map((x, index) => (
            <path key={x} d={`M${x} ${index % 2 ? 46 : 28}l58 33-58 33-58-33z`} opacity={index === 0 || index === 3 ? 0.35 : 0.8} />
          ))}
          {[78, 190, 370, 486].map((x, index) => (
            <circle key={x} cx={x} cy={index % 2 ? 196 : 178} r="24" opacity={index === 0 || index === 3 ? 0.28 : 0.65} />
          ))}
        </g>
        <g fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M280 80v44" />
          <path d="M280 168v42" />
          <path d="M236 145H154" />
          <path d="M324 145h82" />
          <path d="M248 116l-64-42" />
          <path d="M312 116l64-42" />
          <path d="M248 174l-64 42" />
          <path d="M312 174l64 42" />
        </g>
        {[
          [280, 52],
          [280, 232],
          [132, 145],
          [428, 145],
          [164, 60],
          [396, 60],
          [164, 230],
          [396, 230],
        ].map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <rect x={x - 35} y={y - 18} width="70" height="36" rx="18" fill={paper} stroke={soft} />
            <text x={x} y={y + 4} textAnchor="middle" fill={stroke} fontSize="11" fontFamily="monospace" letterSpacing="1.5">
              HTTP
            </text>
          </g>
        ))}
        <g>
          <rect x="232" y="104" width="96" height="82" rx="18" fill={paper} stroke={stroke} strokeWidth="2" />
          <rect x="252" y="125" width="56" height="40" rx="8" fill={ink} opacity="0.92" />
          <text x="280" y="150" textAnchor="middle" fill={paper} fontSize="15" fontFamily="monospace" fontWeight="700">
            API
          </text>
        </g>
      </svg>
    )
  }

  if (type === 'mcp') {
    return (
      <svg viewBox="0 0 560 260" className="h-full w-full" role="img" aria-label="MCP registry network">
        <defs>
          <linearGradient id="mcpFade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={paper} stopOpacity="0" />
            <stop offset="1" stopColor={paper} stopOpacity="0.95" />
          </linearGradient>
        </defs>

        <g fill="none" stroke={faint} strokeWidth="1">
          <path d="M64 60h432M64 132h432M64 204h432" opacity="0.32" />
          <path d="M104 36v188M280 36v188M456 36v188" opacity="0.2" />
        </g>

        <g fill="none" stroke={stroke} strokeLinecap="round" strokeLinejoin="round" opacity="0.82">
          <path d="M186 96H236" strokeWidth="2" />
          <path d="M324 96H374" strokeWidth="2" />
          <path d="M280 130v42" strokeWidth="2" />
          <path d="M104 172h352" strokeWidth="1.5" />
          <path d="M152 172v-36M408 172v-36" strokeWidth="1.5" />
          <path d="M222 172v28M338 172v28" strokeWidth="1.5" strokeDasharray="5 8" />
        </g>

        <g transform="translate(236 62)">
          <rect width="88" height="68" rx="14" fill={paper} stroke={stroke} strokeWidth="2" />
          <text x="44" y="37" textAnchor="middle" fill={ink} fontSize="17" fontFamily="monospace" fontWeight="700" letterSpacing="1.8">
            MCP
          </text>
          <text x="44" y="53" textAnchor="middle" fill={stroke} fontSize="8" fontFamily="monospace" letterSpacing="1.2">
            registry
          </text>
        </g>

        <g transform="translate(80 60)">
          <rect width="112" height="72" rx="14" fill={paper} stroke={soft} />
          <image
            href="/brand/integrations/claude-color.svg"
            x="18"
            y="18"
            width="36"
            height="36"
            preserveAspectRatio="xMidYMid meet"
          />
          <text x="78" y="42" textAnchor="middle" fill={ink} fontSize="11" fontFamily="monospace" letterSpacing="1">
            Claude
          </text>
        </g>

        <g transform="translate(368 60)">
          <rect width="112" height="72" rx="14" fill={paper} stroke={soft} />
          <image
            href="/brand/integrations/codex.svg"
            x="18"
            y="16"
            width="40"
            height="40"
            preserveAspectRatio="xMidYMid meet"
          />
          <text x="80" y="42" textAnchor="middle" fill={ink} fontSize="11" fontFamily="monospace" letterSpacing="1">
            Codex
          </text>
        </g>

        {[
          { x: 78, label: 'search' },
          { x: 194, label: 'docs' },
          { x: 310, label: 'pda' },
          { x: 426, label: 'build' },
        ].map((node) => (
          <g key={node.label} transform={`translate(${node.x} 190)`}>
            <rect width="64" height="30" rx="15" fill={paper} stroke={soft} />
            <circle cx="15" cy="15" r="3.5" fill={stroke} />
            <text x="38" y="18.5" textAnchor="middle" fill={stroke} fontSize="9" fontFamily="monospace" letterSpacing="0.8">
              {node.label}
            </text>
          </g>
        ))}

        <g fill={paper} stroke={stroke} strokeWidth="1.4">
          <circle cx="186" cy="96" r="4.5" />
          <circle cx="236" cy="96" r="4.5" />
          <circle cx="324" cy="96" r="4.5" />
          <circle cx="374" cy="96" r="4.5" />
          <circle cx="152" cy="136" r="4.5" />
          <circle cx="408" cy="136" r="4.5" />
          <circle cx="280" cy="172" r="4.5" />
        </g>
      </svg>
    )
  }

  if (type === 'docs') {
    return (
      <svg viewBox="0 0 560 260" className="h-full w-full" role="img" aria-label="AI-ready documents">
        <g fill="none" stroke={faint} strokeWidth="1">
          <path d="M78 66h404" opacity="0.5" />
          <path d="M120 214h320" opacity="0.35" />
          <path d="M170 28v208" opacity="0.25" />
          <path d="M390 28v208" opacity="0.25" />
        </g>
        {[
          { x: 118, y: 60, o: 0.45, s: 0.9 },
          { x: 206, y: 36, o: 0.75, s: 1 },
          { x: 298, y: 72, o: 1, s: 1.05 },
        ].map((doc, index) => (
          <g key={doc.x} opacity={doc.o} transform={`translate(${doc.x} ${doc.y}) scale(${doc.s})`}>
            <path d="M0 0h90l28 28v118H0z" fill={paper} stroke={stroke} strokeWidth="2" />
            <path d="M90 0v28h28" fill="none" stroke={stroke} strokeWidth="2" />
            <path d="M20 52h68M20 76h78M20 100h46" stroke={soft} strokeWidth="8" strokeLinecap="round" />
            <circle cx="88" cy="112" r="22" fill={index === 2 ? ink : paper} stroke={stroke} />
            <path d="M78 111l8 8 15-18" stroke={index === 2 ? paper : stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ))}
        <g transform="translate(120 192)">
          <rect width="320" height="34" rx="17" fill={paper} stroke={soft} />
          <text x="160" y="22" textAnchor="middle" fill={stroke} fontSize="12" fontFamily="monospace" letterSpacing="1.4">
            llms.txt / markdown / schema
          </text>
        </g>
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 560 260" className="h-full w-full" role="img" aria-label="PDA and account data boxes">
      <g fill="none" stroke={faint} strokeWidth="1">
        <path d="M112 58l80 45-80 45-80-45z" opacity="0.42" />
        <path d="M448 58l80 45-80 45-80-45z" opacity="0.42" />
        <path d="M280 146l80 45-80 45-80-45z" opacity="0.5" />
      </g>
      <g fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M148 126l90 48" />
        <path d="M412 126l-90 48" />
        <path d="M280 70v88" strokeDasharray="5 8" />
      </g>
      {[
        { x: 88, y: 86, label: 'seed' },
        { x: 424, y: 86, label: 'acct' },
        { x: 256, y: 42, label: 'PDA' },
        { x: 256, y: 166, label: 'data' },
      ].map((box, index) => (
        <g key={box.label} transform={`translate(${box.x} ${box.y})`}>
          <path d="M24 0l64 36v72l-64 36-64-36V36z" fill={paper} stroke={index === 2 ? stroke : soft} strokeWidth={index === 2 ? 2 : 1.5} />
          <path d="M-40 36l64 36 64-36M24 72v72" stroke={soft} strokeWidth="1.5" fill="none" />
          <text x="24" y="82" textAnchor="middle" fill={index === 2 ? ink : stroke} fontSize="12" fontFamily="monospace" fontWeight={index === 2 ? 700 : 500} letterSpacing="1">
            {box.label}
          </text>
        </g>
      ))}
      <g transform="translate(202 204)">
        <rect width="156" height="36" rx="18" fill={ink} opacity="0.9" />
        <text x="78" y="23" textAnchor="middle" fill={paper} fontSize="12" fontFamily="monospace" letterSpacing="1.2">
          account data
        </text>
      </g>
    </svg>
  )
}

export default function Home(): JSX.Element {
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

          <div className="mt-16 grid w-full max-w-2xl grid-cols-3 divide-x divide-border-low border-y border-border-low">
            {proofStats.map((stat) => (
              <div key={stat.label} className="px-4 py-5">
                <p className="font-mono text-2xl text-sand-1600">{stat.value}</p>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-sand-1100">
                  {stat.label}
                </p>
              </div>
            ))}
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
          <Card className="min-w-0 overflow-hidden p-5 md:p-6" tone="sand">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">
                  REST transaction build
                </p>
                <h2 className="mt-2 text-xl font-semibold text-sand-1600">
                  HTTP in, base58 transaction out.
                </h2>
              </div>
              <Terminal className="size-5 text-sand-1100" aria-hidden="true" />
            </div>
            <CodeBlock
              language="bash"
              code={curlExample}
              copyable={false}
              wrapLongLines
              maxHeightClassName="max-h-[340px]"
            />
          </Card>

          <Card className="min-w-0 overflow-hidden p-5 md:p-6" tone="sand">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">
                  AI agent setup
                </p>
                <h2 className="mt-2 text-xl font-semibold text-sand-1600">
                  Give Claude program-level Solana tools.
                </h2>
              </div>
              <ShieldCheck className="size-5 text-sand-1100" aria-hidden="true" />
            </div>
            <CodeBlock
              language="json"
              code={mcpConfig}
              copyable={false}
              wrapLongLines
              maxHeightClassName="max-h-[340px]"
            />
            <CodeBlock
              language="bash"
              code="claude mcp add --transport http orquestra https://api.orquestra.dev/mcp"
              copyable={false}
              wrapLongLines
              maxHeightClassName="max-h-[340px]"
            />
          </Card>
        </section>

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
