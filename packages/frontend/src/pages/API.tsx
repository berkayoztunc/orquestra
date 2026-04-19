const API_BASE = 'https://api.orquestra.dev'

const discoveryLinks = [
  {
    label: 'OpenAPI',
    href: `${API_BASE}/openapi.json`,
    description: 'Machine-readable API description for the public Orquestra endpoints.',
  },
  {
    label: 'API Catalog',
    href: '/.well-known/api-catalog',
    description: 'RFC 9727 API catalog for automated service discovery.',
  },
  {
    label: 'OAuth Metadata',
    href: `${API_BASE}/.well-known/oauth-protected-resource`,
    description: 'Protected resource metadata for API authentication discovery.',
  },
]

const endpoints = [
  {
    method: 'GET',
    path: '/api/projects',
    summary: 'List and search public projects.',
  },
  {
    method: 'GET',
    path: '/api/projects/by-program/{programId}',
    summary: 'Resolve a project from its Solana program id.',
  },
  {
    method: 'GET',
    path: '/api/{projectId}/instructions',
    summary: 'Inspect available instructions and their arguments.',
  },
  {
    method: 'POST',
    path: '/api/{projectId}/instructions/{instructionName}/build',
    summary: 'Build an unsigned base58 transaction payload.',
  },
  {
    method: 'GET',
    path: '/api/{projectId}/pda',
    summary: 'Discover PDA-derivable accounts and seed schemas.',
  },
  {
    method: 'POST',
    path: '/mcp',
    summary: 'Streamable HTTP MCP endpoint for agent tooling.',
  },
]

export default function API(): JSX.Element {
  return (
    <div className="max-w-5xl mx-auto space-y-10">
      <section className="space-y-4">
        <span className="badge badge-secondary text-xs">API Docs</span>
        <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight">
          Orquestra public API
        </h1>
        <p className="text-gray-400 max-w-3xl leading-relaxed">
          Orquestra turns public Anchor IDLs into machine-readable endpoints for program search,
          instruction discovery, PDA derivation, and unsigned Solana transaction building.
        </p>
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        {discoveryLinks.map((link) => (
          <a
            key={link.label}
            href={link.href}
            className="card p-5 space-y-3 hover:border-primary/40 transition-colors"
          >
            <div>
              <h2 className="text-white font-semibold">{link.label}</h2>
              <p className="text-gray-400 text-sm mt-2 leading-relaxed">{link.description}</p>
            </div>
            <div className="text-primary text-xs font-mono break-all">{link.href}</div>
          </a>
        ))}
      </section>

      <section className="card p-6 space-y-5">
        <div>
          <h2 className="text-2xl font-bold text-white">Base URL</h2>
          <p className="text-gray-400 text-sm mt-2">Use the API host directly for programmatic access.</p>
        </div>
        <pre className="bg-dark-900 rounded-2xl border border-white/10 p-4 overflow-x-auto text-sm text-secondary">
          <code>{API_BASE}</code>
        </pre>
      </section>

      <section className="card p-6 space-y-5">
        <div>
          <h2 className="text-2xl font-bold text-white">Core endpoints</h2>
          <p className="text-gray-400 text-sm mt-2">
            These are the primary public endpoints surfaced in the API catalog and OpenAPI document.
          </p>
        </div>
        <div className="space-y-3">
          {endpoints.map((endpoint) => (
            <div key={endpoint.path} className="rounded-2xl border border-white/10 bg-surface-elevated p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
                <span className="text-xs font-mono text-primary">{endpoint.method}</span>
                <code className="text-sm text-white break-all">{endpoint.path}</code>
              </div>
              <p className="text-sm text-gray-400 mt-2">{endpoint.summary}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-6 space-y-5">
        <div>
          <h2 className="text-2xl font-bold text-white">Authentication</h2>
          <p className="text-gray-400 text-sm mt-2">
            Protected endpoints use bearer session tokens for signed-in users or project-scoped API keys in the X-API-Key header.
          </p>
        </div>
        <pre className="bg-dark-900 rounded-2xl border border-white/10 p-4 overflow-x-auto text-sm text-gray-300">
          <code>{`curl -X POST ${API_BASE}/api/{projectId}/instructions/{instructionName}/build \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_PROJECT_KEY" \\
  -d '{
    "accounts": {"payer": "..."},
    "args": {},
    "feePayer": "..."
  }'`}</code>
        </pre>
      </section>
    </div>
  )
}