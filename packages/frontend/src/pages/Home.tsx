import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { getGitHubLoginUrl } from '../api/client'
import CodeBlock from '../components/CodeBlock'
import TwitterWall from '../components/TwitterWall'

const sidebarFeatures = [
  {
    id: 'tx',
    label: 'Transaction Builder',
    heading: 'Build Solana transactions with a single HTTP call.',
    desc: 'POST your accounts and args. Get a base58-encoded, wallet-ready transaction back. Borsh serialization, Anchor discriminators, and instruction layout — all handled server-side.',
    bullets: ['Borsh serialization', 'Anchor discriminators', 'Base58 output'],
    language: 'bash' as const,
    code: `curl -X POST https://api.orquestra.dev/v1/projects/marinade/instructions/deposit \\
  -H "X-API-Key: orq_live_xxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "accounts": {
      "state": "8szGkuLTAux9XMgZ2vtY39jVSowEoQBLB2Dc4DJEfKHQ",
      "msolMint": "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
      "userMsolAccount": "9xTy...pQr2"
    },
    "args": { "lamports": 1000000000 }
  }'

# Response → base58 transaction ready for signing
{
  "transaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAECeS8r..."
}`,
  },
  {
    id: 'pda',
    label: 'PDA Derivation',
    heading: 'Derive program-derived addresses — no SDK, no WASM.',
    desc: 'Pass seed values and get deterministic PDA addresses back. Works from any HTTP client, any language, any device on the network.',
    bullets: ['Seed-based derivation', 'Returns address + bump', 'No local keypair needed'],
    language: 'bash' as const,
    code: `curl https://api.orquestra.dev/v1/projects/my-program/pda \\
  -H "X-API-Key: orq_live_xxxx" \\
  -G \\
  --data-urlencode "seeds[]=user" \\
  --data-urlencode "seeds[]=wallet:9xTy...pQr2"

# Response
{
  "address": "F8AgKDcR7fNwZNGBkNe7mW2XhD6JmVJkLpGfuQzDkM9",
  "bump": 255,
  "seeds": ["user", "wallet:9xTy...pQr2"]
}`,
  },
  {
    id: 'docs',
    label: 'AI Documentation',
    heading: 'Docs that write themselves — and stay current.',
    desc: 'Every IDL gets auto-generated Markdown documentation optimized for LLM context windows. Feed it directly to Claude, Cursor, or any AI tool. No manual writing.',
    bullets: ['LLM-context-optimized', 'Full API reference', 'Always in sync with IDL'],
    language: 'text' as const,
    code: `# Marinade Finance — deposit

Deposit SOL and receive mSOL (liquid staking token).

## Accounts

| Name            | Writable | Signer | Description           |
|-----------------|----------|--------|-----------------------|
| state           | ✅       | ❌     | Marinade state account|
| msolMint        | ✅       | ❌     | mSOL mint address     |
| userMsolAccount | ✅       | ❌     | User mSOL token acct  |

## Args

| Name     | Type | Description                    |
|----------|------|-------------------------------|
| lamports | u64  | Amount of SOL (in lamports)   |`,
  },
  {
    id: 'mcp',
    label: 'MCP Server',
    heading: 'Every program — instantly accessible to AI agents.',
    desc: 'One JSON config block gives Claude, Cursor, or GitHub Copilot full access to 1,000+ Solana programs. Search, build, derive — all from natural language.',
    bullets: ['7 MCP tools', 'Works with Claude & Cursor', 'Natural language → transaction'],
    language: 'json' as const,
    code: `{
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
}`,
  },
]

export default function Home(): JSX.Element {
  const { isAuthenticated } = useAuthStore()
  const [activeFeature, setActiveFeature] = useState(sidebarFeatures[0])

  return (
    <div className="space-y-36">

      {/* ── Hero ── */}
      <section className="relative pt-24 pb-12 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/3 left-1/4 w-[700px] h-[700px] bg-primary/4 rounded-full blur-[140px]" />
          <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-secondary/4 rounded-full blur-[120px]" />
        </div>
        <div className="relative max-w-4xl mx-auto text-center px-6">
          <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-[1.06] tracking-tight">
            <span className="text-white">The REST API for</span>
            <br />
            <span className="gradient-text">Solana programs.</span>
          </h1>
          <p className="text-lg md:text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Upload your Anchor IDL. Get a production REST API, AI-ready docs, and an MCP server
            — in 30 seconds. No backend code, no SDK, no infrastructure.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            {isAuthenticated ? (
              <Link to="/dashboard" className="btn-primary text-base px-8 py-4">Go to Dashboard</Link>
            ) : (
              <a href={getGitHubLoginUrl()} className="btn-primary text-base px-8 py-4">Get Started — It's Free</a>
            )}
            <Link to="/explorer" className="btn-secondary text-base px-8 py-4">Browse 1,000+ Programs</Link>
          </div>
        </div>
      </section>

      

      {/* ── How It Works ── */}
      <section className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            <span className="text-white">How </span>
            <span className="gradient-text">It Works</span>
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            From zero to a production Solana API in four steps. No backend code, no devops, no Anchor SDK on the client.
          </p>
        </div>
        <div className="relative">
          <div className="hidden md:block absolute top-8 left-[calc(12.5%+2rem)] right-[calc(12.5%+2rem)] h-px bg-gradient-to-r from-primary/10 via-primary/40 to-primary/10 pointer-events-none" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              {
                num: '1',
                title: 'Sign In with GitHub',
                desc: 'OAuth in one click. No passwords, no forms. Your projects are ready immediately.',
                accent: 'primary',
                path: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
              },
              {
                num: '2',
                title: 'Upload Your IDL',
                desc: 'Drag and drop your Anchor IDL JSON. We validate, parse, and index every instruction and type.',
                accent: 'primary',
                path: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12',
              },
              {
                num: '3',
                title: 'Build & Send Transactions',
                desc: 'POST accounts and args, get a base58 tx back. Sign with any wallet and broadcast to Solana.',
                accent: 'primary',
                path: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8',
              },
              {
                num: '4',
                title: 'Connect Your AI Agent',
                desc: 'Add the MCP endpoint to Claude, Cursor, or Copilot. Your agent can now build Solana transactions from prompts.',
                accent: 'secondary',
                path: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
              },
            ].map(({ num, title, desc, accent, path }) => (
              <div key={num} className="flex flex-col items-center text-center group">
                <div className={`relative w-16 h-16 rounded-2xl bg-surface-elevated border border-${accent}/25 flex items-center justify-center mb-5 z-10 group-hover:border-${accent}/60 group-hover:bg-${accent}/10 transition-all duration-300`}>
                  <svg className={`w-7 h-7 text-${accent}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={path} />
                  </svg>
                  <span className={`absolute -top-2 -right-2 w-5 h-5 rounded-full bg-${accent} text-dark-900 text-xs font-bold flex items-center justify-center`}>
                    {num}
                  </span>
                </div>
                <h4 className="font-bold text-white mb-2 text-sm">{title}</h4>
                <p className="text-xs text-gray-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Sidebar feature section ── */}
      <section className="max-w-6xl mx-auto px-6">
        <div className="mb-16 max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-5 leading-tight">
            <span className="text-white">An API platform built for </span>
            <span className="gradient-text">Solana developers.</span>
          </h2>
          <p className="text-gray-400 leading-relaxed text-lg">
            Orquestra has opinions on everything — serialization, discriminators, PDA derivation, and
            documentation. Fewer decisions for you. Less code to ship.
          </p>
        </div>

        <div className="grid md:grid-cols-[220px_1fr] gap-12 items-start">
          {/* Left — vertical nav */}
          <nav className="flex flex-col md:sticky md:top-24">
            {sidebarFeatures.map((f) => (
              <button
                key={f.id}
                onClick={() => setActiveFeature(f)}
                className={`text-left px-4 py-3.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center gap-2.5 ${
                  activeFeature.id === f.id
                    ? 'text-white bg-surface-card border border-white/8'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-surface-elevated'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors ${
                    activeFeature.id === f.id ? 'bg-primary' : 'bg-gray-700'
                  }`}
                />
                {f.label}
              </button>
            ))}
            <div className="mt-8 pt-6 border-t border-white/5">
              <Link to="/explorer" className="text-xs text-primary hover:text-primary/70 transition-colors font-medium">
                Explore all programs →
              </Link>
            </div>
          </nav>

          {/* Right — content */}
          <div className="space-y-7">
            <div>
              <h3 className="text-2xl font-bold text-white mb-3 leading-snug">{activeFeature.heading}</h3>
              <p className="text-gray-400 leading-relaxed">{activeFeature.desc}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeFeature.bullets.map((b) => (
                <span key={b} className="flex items-center gap-1.5 text-sm text-gray-300 bg-surface-elevated border border-white/5 rounded-lg px-3 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                  {b}
                </span>
              ))}
            </div>
            <div className="rounded-2xl overflow-hidden border border-white/5">
              <CodeBlock language={activeFeature.language} code={activeFeature.code} copyable={false} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Editorial section A: Transaction Builder ── */}
      <section className="max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-2 gap-16 md:gap-20 items-center">
          {/* Copy */}
          <div className="space-y-8">
            <p className="text-xs text-primary font-bold uppercase tracking-[0.15em]">Transaction Builder</p>
            <h2 className="text-3xl md:text-4xl font-bold leading-tight">
              <span className="text-white">Build transactions<br />from </span>
              <span className="gradient-text">any language.</span>
            </h2>
            <p className="text-gray-400 leading-relaxed text-[15px]">
              No Solana SDK. No Borsh library. No bundler pain. POST accounts and arguments
              — Orquestra handles serialization, computes the Anchor discriminator, and returns
              a base58-encoded transaction ready for any wallet to sign and broadcast.
            </p>
            <ul className="space-y-5">
              {[
                {
                  title: 'Language agnostic',
                  desc: 'Works with curl, Python, Go, Rust, Swift — anything that can POST JSON.',
                },
                {
                  title: 'No SDK on the client',
                  desc: 'The full transaction is built server-side. Zero Solana tooling needed in your app.',
                },
                {
                  title: 'Mobile & IoT ready',
                  desc: 'Perfect for React Native, MicroPython, or any embedded device on the network.',
                },
              ].map(({ title, desc }) => (
                <li key={title} className="flex items-start gap-4">
                  <div className="w-5 h-5 rounded-full border border-primary/40 bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white text-sm font-semibold mb-0.5">{title}</p>
                    <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Link to="/explorer" className="inline-flex items-center gap-2 text-sm text-primary font-medium group">
              <span>Explore programs</span>
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </Link>
          </div>

          {/* Visual */}
          <div className="rounded-2xl overflow-hidden border border-white/5 bg-surface-elevated">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-white/5">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
              </div>
              <span className="text-xs text-gray-600 font-mono ml-2">build.sh</span>
            </div>
            <CodeBlock
              language="bash"
              copyable={false}
              code={`curl -X POST https://api.orquestra.dev/v1/projects/marinade/instructions/deposit \\
  -H "X-API-Key: orq_live_xxxx" \\
  -d '{
    "accounts": {
      "state": "8szGk...Q",
      "userMsolAccount": "9xTy...pQr2"
    },
    "args": { "lamports": 1000000000 }
  }'

# ← base58-encoded transaction ready for signing
{
  "transaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA..."
}`}
            />
          </div>
        </div>
      </section>

      {/* ── Editorial section B: AI Agents (reversed) ── */}
      <section className="max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-2 gap-16 md:gap-20 items-center">
          {/* Visual — left */}
          <div className="order-2 md:order-1 rounded-2xl overflow-hidden border border-white/5 bg-surface-elevated">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
                </div>
                <span className="text-xs text-gray-600 font-mono ml-2">claude_desktop_config.json</span>
              </div>
              <span className="text-[10px] bg-secondary/10 text-secondary border border-secondary/20 rounded px-2 py-0.5 font-medium">MCP</span>
            </div>
            <CodeBlock
              language="json"
              copyable={false}
              code={`{
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
}`}
            />
            <div className="border-t border-white/5 px-5 py-4 bg-surface/50 space-y-2">
              <p className="text-xs text-gray-500 italic">
                "Build a deposit instruction for Marinade with 1 SOL for wallet 9xTy…"
              </p>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-secondary/15 border border-secondary/30 flex items-center justify-center">
                  <span className="text-secondary text-[8px] font-bold">AI</span>
                </div>
                <span className="text-xs text-secondary">Claude, via Orquestra MCP</span>
              </div>
            </div>
          </div>

          {/* Copy — right */}
          <div className="space-y-8 order-1 md:order-2">
            <p className="text-xs text-secondary font-bold uppercase tracking-[0.15em]">Model Context Protocol</p>
            <h2 className="text-3xl md:text-4xl font-bold leading-tight">
              <span className="text-white">AI agents can talk to </span>
              <span className="gradient-text">Solana programs.</span>
            </h2>
            <p className="text-gray-400 leading-relaxed text-[15px]">
              Add one JSON block to your Claude or Cursor config. Your AI agent instantly gets
              access to 1,000+ Solana programs — it can search by name, build signed-ready
              transactions, and derive PDAs from plain English prompts.
            </p>
            <ul className="space-y-4">
              {[
                { fn: 'search_programs', desc: 'Find any Solana program by name, address, or category.' },
                { fn: 'build_instruction', desc: 'Build a base58 transaction from a natural language prompt.' },
                { fn: 'derive_pda', desc: 'Compute program-derived addresses from seed values.' },
                { fn: 'fetch_pda_data', desc: 'Read on-chain account data, deserialized against the IDL.' },
              ].map(({ fn, desc }) => (
                <li key={fn} className="flex items-start gap-3">
                  <code className="text-xs bg-surface-elevated border border-secondary/20 text-secondary px-2.5 py-1 rounded-lg font-mono flex-shrink-0 mt-0.5">
                    {fn}
                  </code>
                  <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
                </li>
              ))}
            </ul>
            <Link to="/mcp" className="inline-flex items-center gap-2 text-sm text-secondary font-medium group">
              <span>Connect your AI agent</span>
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Editorial section C: Auto Docs ── */}
      <section className="max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-2 gap-16 md:gap-20 items-center">
          {/* Copy */}
          <div className="space-y-8">
            <p className="text-xs text-primary font-bold uppercase tracking-[0.15em]">Documentation</p>
            <h2 className="text-3xl md:text-4xl font-bold leading-tight">
              <span className="text-white">Documentation that </span>
              <span className="gradient-text">writes itself.</span>
            </h2>
            <p className="text-gray-400 leading-relaxed text-[15px]">
              Every IDL you upload gets full Markdown documentation, automatically generated and
              kept in sync. Structured for LLM context windows — paste it straight into Claude,
              Cursor, or any AI tool. No manual writing, no reformatting.
            </p>
            <ul className="space-y-5">
              {[
                {
                  title: 'Always in sync',
                  desc: 'Regenerated every time your IDL changes. Zero manual effort required.',
                },
                {
                  title: 'LLM-optimized format',
                  desc: 'Structured tables, clear type descriptions, usage examples — tuned for AI context.',
                },
                {
                  title: 'REST + MCP accessible',
                  desc: 'Fetch docs via the REST API or let your agent read them directly via MCP.',
                },
              ].map(({ title, desc }) => (
                <li key={title} className="flex items-start gap-4">
                  <div className="w-5 h-5 rounded-full border border-primary/40 bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white text-sm font-semibold mb-0.5">{title}</p>
                    <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Link to="/explorer" className="inline-flex items-center gap-2 text-sm text-primary font-medium group">
              <span>See documentation examples</span>
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </Link>
          </div>

          {/* Visual — docs preview */}
          <div className="rounded-2xl overflow-hidden border border-white/5 bg-surface-elevated">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-white/5">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
              </div>
              <span className="text-xs text-gray-600 font-mono ml-2">marinade_finance.md</span>
            </div>
            <div className="p-6 space-y-5 font-mono text-xs">
              <div>
                <p className="text-primary font-bold text-sm"># deposit</p>
                <p className="text-gray-500 mt-1.5 font-sans text-sm">
                  Deposit SOL and receive mSOL (liquid staking token).
                </p>
              </div>
              <div>
                <p className="text-gray-300 font-bold mb-2">## Accounts</p>
                <div className="rounded-lg overflow-hidden border border-white/5">
                  <table className="w-full text-xs">
                    <thead className="bg-surface">
                      <tr>
                        <th className="text-left px-3 py-2 text-gray-500 font-medium">Name</th>
                        <th className="text-left px-3 py-2 text-gray-500 font-medium">Type</th>
                        <th className="text-left px-3 py-2 text-gray-500 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { name: 'state', type: 'writable', desc: 'Marinade state' },
                        { name: 'msolMint', type: 'writable', desc: 'mSOL mint' },
                        { name: 'liqPoolSolLeg', type: 'writable', desc: 'SOL liquidity leg' },
                        { name: 'transferFrom', type: 'signer', desc: 'User wallet' },
                      ].map((row) => (
                        <tr key={row.name} className="border-t border-white/5">
                          <td className="px-3 py-2 text-secondary">{row.name}</td>
                          <td className="px-3 py-2 text-primary/70">{row.type}</td>
                          <td className="px-3 py-2 text-gray-500">{row.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <p className="text-gray-300 font-bold mb-2">## Args</p>
                <div className="bg-surface rounded-lg px-4 py-3 border border-white/5 flex items-center gap-2">
                  <span className="text-secondary">lamports</span>
                  <span className="text-gray-700">·</span>
                  <span className="text-primary/70">u64</span>
                  <span className="text-gray-600">— Amount in lamports</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Social Proof ── */}
      <div className="space-y-12">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            <span className="text-white">Trusted by </span>
            <span className="gradient-text">Solana builders</span>
          </h2>
          <p className="text-gray-500 max-w-xl mx-auto">
            Developers and teams building on Solana trust Orquestra to handle the hard parts.
          </p>
        </div>
        <TwitterWall />
      </div>

      {/* ── Final CTA ── */}
      <section className="max-w-4xl mx-auto px-6 pb-8 text-center">
        <h2 className="text-4xl md:text-5xl font-bold leading-tight mb-6">
          <span className="text-white">Build without limits.</span>
          <br />
          <span className="gradient-text">What will you ship?</span>
        </h2>
        <p className="text-gray-400 max-w-lg mx-auto leading-relaxed mb-10">
          Upload your first IDL and have a production REST API in under 30 seconds — free, forever.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          {isAuthenticated ? (
            <Link to="/dashboard" className="btn-primary text-base px-8 py-4">Go to Dashboard</Link>
          ) : (
            <a href={getGitHubLoginUrl()} className="btn-primary text-base px-8 py-4">Get Started Free</a>
          )}
          <Link to="/explorer" className="btn-secondary text-base px-8 py-4">Explore Programs</Link>
        </div>
      </section>

    </div>
  )
}
