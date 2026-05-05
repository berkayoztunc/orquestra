import { Link } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { getGitHubLoginUrl } from '../api/client'
import CodeBlock from '../components/CodeBlock'
import TwitterWall from '../components/TwitterWall'
import TryItPanel from '../components/TryItPanel'

const proofStats = [
  { value: '30s', label: 'IDL to hosted API' },
  { value: '7', label: 'MCP tools for agents' },
  { value: '0', label: 'client SDKs required' },
]

const chips = ['IDL -> API', 'MCP tools', 'AI docs', 'Base58 tx']

const workflow = [
  {
    step: '01',
    title: 'Upload IDL',
    desc: 'Anchor interface becomes indexed instructions, accounts, errors, PDAs, and typed args.',
  },
  {
    step: '02',
    title: 'Generate surfaces',
    desc: 'Orquestra publishes REST endpoints, Markdown docs, MCP tools, and transaction builders.',
  },
  {
    step: '03',
    title: 'Connect apps + AI',
    desc: 'Backends, mobile apps, Claude, Cursor, and agents call Solana programs through HTTP.',
  },
]

const capabilities = [
  {
    title: 'Hosted REST API',
    eyebrow: 'For backend teams',
    desc: 'Call any indexed Anchor instruction with JSON. Orquestra handles Borsh layout, discriminators, and serialization.',
    code: 'POST /api/<project>/instructions/deposit/build',
  },
  {
    title: 'MCP registry',
    eyebrow: 'For AI agents',
    desc: 'Expose search, docs, PDA derivation, account reads, simulation, and tx building to Claude or Cursor.',
    code: 'build_instruction({ program, instruction, args })',
  },
  {
    title: 'AI-ready docs',
    eyebrow: 'For context windows',
    desc: 'Generate compact Markdown from IDLs so humans and agents understand accounts, args, and errors fast.',
    code: 'GET /project/<program>/llms.txt',
  },
  {
    title: 'PDA + account data',
    eyebrow: 'For integrations',
    desc: 'Derive addresses, fetch account data, and decode program state without shipping Solana tooling client-side.',
    code: 'derive_pda({ seeds, programId })',
  },
]

const mcpConfig = `{
  "mcpServers": {
    "orquestra": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/client-streamable-http",
        "https://api.orquestra.dev/mcp"
      ]
    }
  }
}`

const curlExample = `curl -X POST https://api.orquestra.dev/api/marinade/instructions/deposit/build \\
  -H "X-API-Key: orq_live_xxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "accounts": { "state": "8szGk...", "user": "9xTy..." },
    "args": { "lamports": 1000000000 },
    "network": "mainnet-beta"
  }'

# -> { "transaction": "AQAAAAAAAAAAAA..." }`

function CtaButtons(): JSX.Element {
  const { isAuthenticated } = useAuthStore()

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {isAuthenticated ? (
        <Link to="/dashboard" className="btn-primary min-h-11 px-6 py-3 text-center text-sm">
          Go to Dashboard
        </Link>
      ) : (
        <a href={getGitHubLoginUrl()} className="btn-primary min-h-11 px-6 py-3 text-center text-sm">
          Start Free
        </a>
      )}
      <Link to="/explorer" className="btn-secondary min-h-11 px-6 py-3 text-center text-sm">
        Browse Programs
      </Link>
    </div>
  )
}

function SystemFlowGraphic(): JSX.Element {
  const nodeClass = 'rounded-2xl border border-white/10 bg-surface-card/95 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur'
  const smallNodeClass = 'rounded-xl border border-white/10 bg-surface-elevated/95 px-3 py-2 text-xs text-gray-300 shadow-[0_12px_40px_rgba(0,0,0,0.28)]'

  return (
    <div className="relative mx-auto w-full max-w-[560px] overflow-hidden rounded-[2rem] border border-white/10 bg-surface-elevated/55 p-4 md:p-6">
      <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-70" />
      <div className="absolute -left-20 top-0 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-secondary/10 blur-3xl" />

      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 560 420" fill="none" aria-hidden="true">
        <path className="motion-safe:animate-draw-line" d="M116 102 C190 102 194 185 260 185" stroke="url(#flowA)" strokeWidth="2" strokeDasharray="8 10" strokeLinecap="round" />
        <path className="motion-safe:animate-draw-line [animation-delay:150ms]" d="M300 185 C376 105 414 96 476 96" stroke="url(#flowB)" strokeWidth="2" strokeDasharray="8 10" strokeLinecap="round" />
        <path className="motion-safe:animate-draw-line [animation-delay:300ms]" d="M304 205 C374 205 402 208 472 208" stroke="url(#flowA)" strokeWidth="2" strokeDasharray="8 10" strokeLinecap="round" />
        <path className="motion-safe:animate-draw-line [animation-delay:450ms]" d="M300 226 C374 302 414 324 476 324" stroke="url(#flowB)" strokeWidth="2" strokeDasharray="8 10" strokeLinecap="round" />
        <defs>
          <linearGradient id="flowA" x1="96" y1="100" x2="476" y2="100" gradientUnits="userSpaceOnUse">
            <stop stopColor="#14F195" stopOpacity="0.05" />
            <stop offset="0.55" stopColor="#14F195" stopOpacity="0.8" />
            <stop offset="1" stopColor="#00D9FF" stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id="flowB" x1="260" y1="150" x2="506" y2="330" gradientUnits="userSpaceOnUse">
            <stop stopColor="#00D9FF" stopOpacity="0.05" />
            <stop offset="0.55" stopColor="#00D9FF" stopOpacity="0.8" />
            <stop offset="1" stopColor="#14F195" stopOpacity="0.25" />
          </linearGradient>
        </defs>
      </svg>

      <div className="relative grid min-h-[340px] grid-cols-[1fr_1.08fr_1fr] items-center gap-3 md:gap-5">
        <div className="space-y-3">
          <div className={`${nodeClass} motion-safe:animate-stagger-in`}>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Input</p>
            <p className="mt-2 text-sm font-bold text-white">Anchor IDL</p>
            <p className="mt-1 font-mono text-[10px] text-gray-500">IDL.json</p>
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-[11px] text-primary motion-safe:animate-node-pulse">
            Live schema detected
          </div>
        </div>

        <div className={`${nodeClass} text-center motion-safe:animate-stagger-in [animation-delay:100ms]`}>
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 shadow-[0_0_40px_rgba(20,241,149,0.15)]">
            <svg className="h-7 w-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9L12 3z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v8m-4-6l4 2 4-2" />
            </svg>
          </div>
          <p className="mt-3 text-base font-bold text-white">Orquestra core</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">Parse, document, serialize, simulate, expose.</p>
        </div>

        <div className="space-y-3">
          {['REST API', 'MCP tools', 'AI docs', 'Base58 tx'].map((label, index) => (
            <div key={label} className={`${smallNodeClass} motion-safe:animate-stagger-in`} style={{ animationDelay: `${180 + index * 70}ms` }}>
              <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle shadow-[0_0_12px_rgba(20,241,149,0.8)]" />
              {label}
            </div>
          ))}
        </div>
      </div>

      <div className="relative mt-3 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-xs md:grid-cols-4">
        {['Python apps', 'Go services', 'Claude', 'Cursor'].map((item) => (
          <div key={item} className="rounded-lg bg-white/[0.03] px-3 py-2 text-center text-gray-400">
            {item}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Home(): JSX.Element {
  return (
    <div className="space-y-14 md:space-y-18">
      <section className="relative overflow-hidden pb-2 pt-10 md:pt-16">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute left-1/2 top-0 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-primary/5 blur-[110px]" />
          <div className="absolute right-0 top-28 h-[360px] w-[360px] rounded-full bg-secondary/5 blur-[100px]" />
        </div>

        <div className="relative grid items-center gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="max-w-2xl motion-safe:animate-stagger-in">
            <h1 className="text-balance text-4xl font-light leading-[1.02] tracking-[-0.045em] text-white sm:text-5xl lg:text-6xl">
              Turn Solana program IDLs into{' '}
              <span className="gradient-text font-black">
                APIs for AI agents
              </span>
              <span className="font-light text-gray-200"> and developer apps.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-gray-400 md:text-lg">
              Orquestra converts Anchor programs into hosted REST endpoints, AI-ready docs, MCP tools, PDA resolution, and wallet-ready transactions.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {chips.map((chip) => (
                <span key={chip} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-gray-300">
                  {chip}
                </span>
              ))}
            </div>

            <div className="mt-7">
              <CtaButtons />
            </div>

            <div className="mt-8 grid max-w-lg grid-cols-3 divide-x divide-white/10 rounded-2xl border border-white/10 bg-surface-elevated/60 p-4">
              {proofStats.map((stat) => (
                <div key={stat.label} className="px-3 first:pl-0 last:pr-0">
                  <p className="text-2xl font-bold text-white">{stat.value}</p>
                  <p className="mt-1 text-xs leading-snug text-gray-500">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="motion-safe:animate-stagger-in [animation-delay:120ms]">
            <SystemFlowGraphic />
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {workflow.map((item, index) => (
          <div key={item.step} className="group rounded-2xl border border-white/10 bg-surface-card/70 p-5 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:hover:-translate-y-1" style={{ animationDelay: `${index * 80}ms` }}>
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono text-xs text-primary">{item.step}</span>
              <span className="h-px flex-1 bg-gradient-to-r from-primary/30 to-transparent ml-4" />
            </div>
            <h2 className="text-lg font-bold text-white">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">{item.desc}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Platform surfaces</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white md:text-4xl">One IDL. Four production interfaces.</h2>
          <p className="mt-4 text-sm leading-6 text-gray-400 md:text-base">
            Orquestra is not another SDK generator. It hosts callable infrastructure so Solana-native teams, web2 backends, and AI agents share one source of truth.
          </p>
          <div className="mt-6 hidden lg:block">
            <CtaButtons />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {capabilities.map((capability) => (
            <article key={capability.title} className="rounded-2xl border border-white/10 bg-surface-elevated/70 p-5 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:hover:-translate-y-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-secondary">{capability.eyebrow}</p>
              <h3 className="mt-2 text-lg font-bold text-white">{capability.title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-400">{capability.desc}</p>
              <code className="mt-4 block overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-white/10 bg-dark-950 px-3 py-2 font-mono text-[11px] text-primary">
                {capability.code}
              </code>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-surface-elevated/60 p-4 md:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">REST transaction build</p>
              <h2 className="mt-1 text-xl font-bold text-white">HTTP in, base58 transaction out.</h2>
            </div>
            <span className="hidden rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary sm:inline-flex">No SDK</span>
          </div>
          <CodeBlock language="bash" code={curlExample} copyable={false} maxHeightClassName="max-h-[340px]" />
        </div>

        <div className="rounded-2xl border border-white/10 bg-surface-elevated/60 p-4 md:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-secondary">AI agent setup</p>
              <h2 className="mt-1 text-xl font-bold text-white">Give Claude program-level Solana tools.</h2>
            </div>
            <span className="hidden rounded-full border border-secondary/20 bg-secondary/10 px-3 py-1 text-xs text-secondary sm:inline-flex">MCP</span>
          </div>
          <CodeBlock language="json" code={mcpConfig} copyable={false} maxHeightClassName="max-h-[340px]" />
        </div>
      </section>

      <section className="rounded-[2rem] border border-primary/15 bg-gradient-to-br from-primary/10 via-surface-elevated to-secondary/10 p-4 md:p-6">
        <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Live proof</p>
            <h2 className="mt-2 text-2xl font-bold text-white md:text-3xl">Build a real transaction at edge speed.</h2>
          </div>
          <Link to="/docs/api" className="inline-flex min-h-10 items-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm font-medium text-gray-300 transition-colors duration-150 hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
            Read API docs
          </Link>
        </div>
        <TryItPanel />
      </section>

      <section className="space-y-6">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-secondary">Builder signal</p>
          <h2 className="mt-2 text-2xl font-bold text-white md:text-3xl">Built for teams shipping Solana integrations.</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-gray-400">
            Protocol docs, transaction building, MCP discovery, and program APIs converge into one developer platform.
          </p>
        </div>
        <TwitterWall />
      </section>

      <section className="relative overflow-hidden pb-8 pt-4">
        <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent" />
        <div className="absolute left-1/2 top-10 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
        <div className="relative grid items-center gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Ship faster</p>
            <h2 className="mt-3 text-balance text-3xl font-light leading-[1.03] tracking-[-0.04em] text-white md:text-5xl">
              Make every Solana program{' '}
              <span className="gradient-text font-black">callable by apps and agents.</span>
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-6 text-gray-400 md:text-base">
              Upload an IDL, then demo production-ready REST APIs, MCP tools, docs, and transaction builders before the hackathon clock runs out.
            </p>
            <div className="mt-7">
              <CtaButtons />
            </div>
          </div>

          <div className="relative min-h-[260px]">
            <svg className="h-full min-h-[260px] w-full" viewBox="0 0 560 300" fill="none" aria-hidden="true">
              <defs>
                <linearGradient id="ctaLine" x1="78" y1="150" x2="482" y2="150" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#14F195" stopOpacity="0" />
                  <stop offset="0.5" stopColor="#14F195" stopOpacity="0.85" />
                  <stop offset="1" stopColor="#00D9FF" stopOpacity="0" />
                </linearGradient>
                <radialGradient id="ctaCore" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(280 150) rotate(90) scale(72)">
                  <stop stopColor="#14F195" stopOpacity="0.28" />
                  <stop offset="1" stopColor="#14F195" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle cx="280" cy="150" r="78" fill="url(#ctaCore)" />
              <ellipse cx="280" cy="150" rx="180" ry="74" stroke="url(#ctaLine)" strokeWidth="1.5" strokeDasharray="7 11" className="motion-safe:animate-draw-line" />
              <ellipse cx="280" cy="150" rx="124" ry="116" stroke="url(#ctaLine)" strokeWidth="1.5" strokeDasharray="7 11" className="motion-safe:animate-draw-line [animation-delay:250ms]" transform="rotate(-18 280 150)" />

              {[
                { x: 280, y: 150, label: 'IDL', fill: 'fill-primary', text: 'text-dark-950' },
                { x: 92, y: 150, label: 'REST', fill: 'fill-surface-card', text: 'text-primary' },
                { x: 468, y: 150, label: 'MCP', fill: 'fill-surface-card', text: 'text-secondary' },
                { x: 222, y: 52, label: 'Docs', fill: 'fill-surface-card', text: 'text-primary' },
                { x: 344, y: 248, label: 'Tx', fill: 'fill-surface-card', text: 'text-secondary' },
              ].map((node, index) => (
                <g key={node.label} className="motion-safe:animate-stagger-in" style={{ animationDelay: `${index * 90}ms` }}>
                  <circle cx={node.x} cy={node.y} r={node.label === 'IDL' ? 36 : 30} className={node.fill} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
                  <circle cx={node.x} cy={node.y} r={node.label === 'IDL' ? 44 : 37} stroke={node.label === 'IDL' ? 'rgba(20,241,149,0.28)' : 'rgba(255,255,255,0.08)'} strokeWidth="1" />
                  <text x={node.x} y={node.y + 4} textAnchor="middle" className={`${node.text} fill-current text-[13px] font-bold`}>
                    {node.label}
                  </text>
                </g>
              ))}

              <path d="M129 150H244" stroke="url(#ctaLine)" strokeWidth="2" strokeLinecap="round" />
              <path d="M316 150H431" stroke="url(#ctaLine)" strokeWidth="2" strokeLinecap="round" />
              <path d="M258 118L233 78" stroke="url(#ctaLine)" strokeWidth="2" strokeLinecap="round" />
              <path d="M303 181L332 220" stroke="url(#ctaLine)" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </section>
    </div>
  )
}
