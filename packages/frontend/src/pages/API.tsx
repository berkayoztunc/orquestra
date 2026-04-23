import { useState } from 'react'
import {
  BookOpenIcon,
  CheckIcon,
  CopyIcon,
  DatabaseIcon,
  GlobeIcon,
  KeyIcon,
  ListIcon,
  SearchIcon,
  ShieldCheckIcon,
  ZapIcon,
} from 'lucide-react'
import CodeBlock from '../components/CodeBlock'

const API_BASE = 'https://api.orquestra.dev'

const discoveryLinks = [
  {
    label: 'OpenAPI',
    href: `${API_BASE}/openapi.json`,
    description: 'Machine-readable API description for the public Orquestra endpoints.',
    external: true,
  },
  {
    label: 'API Catalog',
    href: '/.well-known/api-catalog',
    description: 'RFC 9727 API catalog for automated service discovery.',
    external: false,
  },
  {
    label: 'OAuth Metadata',
    href: `${API_BASE}/.well-known/oauth-protected-resource`,
    description: 'Protected resource metadata for API authentication discovery.',
    external: true,
  },
]

const workflow = [
  {
    icon: SearchIcon,
    title: 'Find a program',
    description: 'Search public projects or resolve a known Solana program id into an Orquestra project.',
  },
  {
    icon: ListIcon,
    title: 'Inspect the IDL surface',
    description: 'List instructions, accounts, and PDA derivation schemas before building a request.',
  },
  {
    icon: ZapIcon,
    title: 'Build unsigned payloads',
    description: 'Generate base58 transaction payloads that wallets or agents can sign client-side.',
  },
]

const endpoints = [
  {
    method: 'GET',
    path: '/api/projects',
    summary: 'List and search public projects.',
    detail: 'Supports discovery-first browsing when you only know a keyword, protocol name, or ecosystem tag.',
  },
  {
    method: 'GET',
    path: '/api/projects/by-program/{programId}',
    summary: 'Resolve a project from its Solana program id.',
    detail: 'Useful when your app starts from an onchain program id and needs the matching Orquestra project metadata.',
  },
  {
    method: 'GET',
    path: '/api/{projectId}/instructions',
    summary: 'Inspect available instructions and their arguments.',
    detail: 'Returns argument shapes, accounts, and other metadata needed to prepare a transaction build call.',
  },
  {
    method: 'POST',
    path: '/api/{projectId}/instructions/{instructionName}/build',
    summary: 'Build an unsigned base58 transaction payload.',
    detail: 'Accepts account inputs, args, and fee payer details, then returns a transaction payload ready for signing.',
  },
  {
    method: 'GET',
    path: '/api/{projectId}/pda',
    summary: 'Discover PDA-derivable accounts and seed schemas.',
    detail: 'Shows which accounts can be derived and what seed inputs are required for deterministic address generation.',
  },
  {
    method: 'GET',
    path: '/api/{projectId}/pda/fetch/{address}',
    summary: 'Fetch on-chain account data and decode it against the project IDL.',
    detail: 'Fetches raw account bytes from the Solana RPC, detects the account type via discriminator, and deserializes all fields as JSON. Accepts a ?network= query parameter (mainnet-beta · devnet · testnet). Returns data: null with a raw base64 field when the account type is not recognized in the IDL.',
    network: true,
  },
  {
    method: 'POST',
    path: '/mcp',
    summary: 'Streamable HTTP MCP endpoint for agent tooling.',
    detail: 'Lets MCP-capable assistants query project metadata and build transactions through the same backend.',
  },
]

const authModes = [
  {
    icon: ShieldCheckIcon,
    title: 'Bearer session token',
    description: 'Use signed-in user sessions for dashboard-driven or user-specific API access.',
    header: 'Authorization',
    value: 'Bearer <session-token>',
  },
  {
    icon: KeyIcon,
    title: 'Project API key',
    description: 'Use project-scoped automation keys for server-to-server calls and transaction builders.',
    header: 'X-API-Key',
    value: '<project-api-key>',
  },
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex min-h-10 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-400 transition-all duration-200 hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      title="Copy"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <>
          <CheckIcon className="h-3.5 w-3.5" />
          Copied
        </>
      ) : (
        <>
          <CopyIcon className="h-3.5 w-3.5" />
          Copy
        </>
      )}
    </button>
  )
}

export default function API(): JSX.Element {
  const curlExample = `curl -X POST ${API_BASE}/api/{projectId}/instructions/{instructionName}/build \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_PROJECT_KEY" \\
  -d '{
    "accounts": {"payer": "..."},
    "args": {},
    "feePayer": "..."
  }'`

  return (
    <div className="animate-fade-in space-y-12">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="badge badge-primary text-xs">Docs</span>
          <span className="text-xs text-gray-600">/</span>
          <span className="font-mono text-xs text-gray-400">api</span>
        </div>

        <h1 className="text-3xl font-bold sm:text-4xl">
          <span className="gradient-text">Public API</span>{' '}
          <span className="text-white">Reference</span>
        </h1>

        <p className="max-w-2xl leading-relaxed text-gray-400">
          Query public Solana program metadata, inspect instruction schemas, derive PDAs, and build
          unsigned transaction payloads through the same Orquestra API surface used by the docs and MCP server.
        </p>

        <div className="flex flex-wrap gap-3">
          <a
            href={`${API_BASE}/openapi.json`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary px-5 py-2.5 text-sm"
          >
            Open OpenAPI Spec
          </a>
          <a href="/.well-known/api-catalog" className="btn-secondary px-5 py-2.5 text-sm">
            View API Catalog
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {workflow.map((step, index) => {
          const Icon = step.icon

          return (
            <div key={step.title} className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-surface-elevated">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <span className="font-mono text-xs text-gray-600">step {index + 1}</span>
              </div>
              <p className="mb-1 text-sm font-semibold text-white">{step.title}</p>
              <p className="text-xs leading-relaxed text-gray-500">{step.description}</p>
            </div>
          )
        })}
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {discoveryLinks.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target={link.external ? '_blank' : undefined}
            rel={link.external ? 'noopener noreferrer' : undefined}
            className="card space-y-3 p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                <BookOpenIcon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-white">{link.label}</h2>
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-gray-600">Discovery</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-gray-400">{link.description}</p>
            <div className="break-all font-mono text-xs text-primary">{link.href}</div>
          </a>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr,0.9fr]">
        <section className="card space-y-4 p-5 sm:p-6">
          <div>
            <h2 className="text-xl font-bold text-white sm:text-2xl">Base URL</h2>
            <p className="mt-2 text-sm text-gray-400">
              Use the API host directly for REST clients, automation scripts, and SDK generation.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-surface-elevated px-4 py-3 font-mono text-sm text-gray-300">
            <span>{API_BASE}</span>
            <CopyButton text={API_BASE} />
          </div>
        </section>

        <section className="card space-y-4 p-5 sm:p-6">
          <div>
            <h2 className="text-xl font-bold text-white sm:text-2xl">Authentication</h2>
            <p className="mt-2 text-sm text-gray-400">
              Public discovery endpoints are open. Build and protected project flows use either a session token or an API key.
            </p>
          </div>
          <div className="space-y-3">
            {authModes.map((mode) => {
              const Icon = mode.icon

              return (
                <div key={mode.title} className="rounded-xl border border-white/5 bg-surface-elevated p-4">
                  <div className="mb-2 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/5 bg-surface-card">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{mode.title}</p>
                      <p className="text-xs text-gray-500">{mode.description}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-dark-900 px-3 py-2 font-mono text-xs text-gray-300">
                    <span className="text-gray-500">{mode.header}:</span> {mode.value}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <section className="card space-y-5 p-5 sm:p-6">
        <div>
          <h2 className="text-xl font-bold text-white sm:text-2xl">Core endpoints</h2>
          <p className="mt-2 text-sm text-gray-400">
            These are the primary routes surfaced in the API catalog and OpenAPI spec for apps, docs, and agents.
          </p>
        </div>
        <div className="space-y-3">
          {endpoints.map((endpoint) => (
            <div key={endpoint.path} className="rounded-xl border border-white/5 bg-surface-elevated p-4">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2 md:flex-row md:items-center md:gap-3">
                  <span className="w-fit rounded-full bg-primary/10 px-2.5 py-1 font-mono text-xs text-primary">
                    {endpoint.method}
                  </span>
                  <code className="break-all text-sm text-white">{endpoint.path}</code>
                  {'network' in endpoint && endpoint.network && (
                    <span className="flex w-fit items-center gap-1 rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 text-[10px] font-medium text-secondary">
                      <GlobeIcon className="h-2.5 w-2.5" />
                      ?network=
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-300">{endpoint.summary}</p>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-gray-500">{endpoint.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-5 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-secondary/20 bg-secondary/10">
            <GlobeIcon className="h-5 w-5 text-secondary" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white sm:text-2xl">Network parameter</h2>
            <p className="mt-0.5 text-xs text-gray-500">Endpoints that query live on-chain data</p>
          </div>
        </div>
        <p className="text-sm text-gray-400 leading-relaxed">
          Endpoints marked with{' '}
          <span className="inline-flex items-center gap-1 rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 text-[10px] font-medium text-secondary">
            <GlobeIcon className="h-2.5 w-2.5" />?network=
          </span>{' '}
          accept an optional{' '}
          <code className="rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-xs text-gray-300">network</code>{' '}
          query parameter to target a specific Solana cluster. Omitting it defaults to{' '}
          <span className="font-mono text-xs text-primary">mainnet-beta</span>.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { value: 'mainnet-beta', label: 'Mainnet', desc: 'Default — live production cluster.', primary: true },
            { value: 'devnet', label: 'Devnet', desc: 'Solana devnet for development and testing.', primary: false },
            { value: 'testnet', label: 'Testnet', desc: 'Solana testnet for validator staging.', primary: false },
          ].map((net) => (
            <div
              key={net.value}
              className={`rounded-xl border p-4 ${net.primary ? 'border-primary/20 bg-primary/5' : 'border-white/5 bg-surface-elevated'}`}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <DatabaseIcon className={`h-4 w-4 ${net.primary ? 'text-primary' : 'text-gray-500'}`} />
                <span className={`text-sm font-semibold ${net.primary ? 'text-primary' : 'text-white'}`}>{net.label}</span>
                {net.primary && (
                  <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] text-primary">default</span>
                )}
              </div>
              <code className="block font-mono text-xs text-gray-400">?network={net.value}</code>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{net.desc}</p>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-white/5 bg-dark-900 p-4">
          <p className="mb-2 font-mono text-xs text-gray-500">example — devnet account fetch</p>
          <code className="block break-all font-mono text-xs text-gray-300">
            {'GET '}
            {API_BASE}
            {'/api/{projectId}/pda/fetch/{address}?network=devnet'}
          </code>
        </div>
      </section>

      <section className="card space-y-4 p-5 sm:p-6">
        <div>
          <h2 className="text-xl font-bold text-white sm:text-2xl">Example request</h2>
          <p className="mt-2 text-sm text-gray-400">
            Build an unsigned instruction payload, then hand the response to your wallet or signing layer.
          </p>
        </div>
        <CodeBlock title="curl transaction build example" code={curlExample} language="bash" />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card space-y-3 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <SearchIcon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Best for app backends</h2>
              <p className="text-xs text-gray-500">REST-first integration</p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-gray-400">
            Use the REST API directly if you are wiring Orquestra into a dashboard, API layer, cron workflow, or custom signing service.
          </p>
        </div>

        <div className="card space-y-3 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-secondary/20 bg-secondary/10">
              <ZapIcon className="h-4 w-4 text-secondary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Best for agents</h2>
              <p className="text-xs text-gray-500">MCP-first integration</p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-gray-400">
            Use the MCP endpoint when you want AI clients to discover tools, inspect instruction metadata, and build payloads conversationally.
          </p>
        </div>
      </section>
    </div>
  )
}
