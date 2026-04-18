import { Link } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { getGitHubLoginUrl } from '../api/client'

export default function Home(): JSX.Element {
  const { isAuthenticated } = useAuthStore()

  return (
    <div className="space-y-24">
      {/* Hero Section */}
      <section className="relative pt-12 pb-20">
        {/* Background Effects */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-secondary/5 rounded-full blur-3xl" />
        </div>
        
        <div className="relative max-w-4xl mx-auto text-center px-6">
         
          
          <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
            <span className="text-white">Build Solana APIs</span>
            <br />
            <span className="gradient-text">in seconds</span>
          </h1>
          
          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Upload your Anchor IDL. Get a REST API, AI docs, and an MCP server — in 30 seconds.
            No backend code, no SDK, no infrastructure setup.
          </p>
          
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className="btn-primary text-base px-8 py-4"
              >
                Go to Dashboard
              </Link>
            ) : (
              <a
                href={getGitHubLoginUrl()}
                className="btn-primary text-base px-8 py-4"
              >
                Get Started Free
              </a>
            )}
            <Link
              to="/explorer"
              className="btn-secondary text-base px-8 py-4"
            >
              Explore Programs
            </Link>
          </div>

          {/* Stats bar */}
          <div className="mt-16 flex flex-wrap justify-center gap-8 md:gap-12">
            <div className="text-center">
              <p className="text-3xl font-bold text-white">1,000+</p>
              <p className="text-xs text-gray-500 mt-1">Programs Indexed</p>
            </div>
            <div className="w-px bg-white/10 hidden sm:block" />
            <div className="text-center">
              <p className="text-3xl font-bold text-white">7</p>
              <p className="text-xs text-gray-500 mt-1">MCP Tools</p>
            </div>
            <div className="w-px bg-white/10 hidden sm:block" />
            <div className="text-center">
              <p className="text-3xl font-bold gradient-text">100% Free</p>
              <p className="text-xs text-gray-500 mt-1">Open Source</p>
            </div>
            <div className="w-px bg-white/10 hidden sm:block" />
            <div className="text-center">
              <p className="text-3xl font-bold text-white">&lt;50ms</p>
              <p className="text-xs text-gray-500 mt-1">Edge Latency</p>
            </div>
          </div>
        </div>
      </section>
   {/* How It Works */}
      <section className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            <span className="text-white">How </span>
            <span className="gradient-text">It Works</span>
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            From zero to a production Solana API in four steps. No backend code, no devops,
            no Anchor SDK on the client.
          </p>
        </div>

        <div className="relative">
          {/* Connecting line between circles on desktop */}
          <div className="hidden md:block absolute top-8 left-[calc(12.5%+2rem)] right-[calc(12.5%+2rem)] h-px bg-gradient-to-r from-primary/10 via-primary/40 to-primary/10 pointer-events-none" />

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Step 1 */}
            <div className="flex flex-col items-center text-center group">
              <div className="relative w-16 h-16 rounded-2xl bg-surface-elevated border border-primary/25 flex items-center justify-center mb-5 z-10 group-hover:border-primary/60 group-hover:bg-primary/10 transition-all duration-300">
                <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary text-dark-900 text-xs font-bold flex items-center justify-center">1</span>
              </div>
              <h4 className="font-bold text-white mb-2 text-sm">Sign In with GitHub</h4>
              <p className="text-xs text-gray-400 leading-relaxed">OAuth in one click. No passwords, no forms. Your projects are ready immediately.</p>
            </div>

            {/* Step 2 */}
            <div className="flex flex-col items-center text-center group">
              <div className="relative w-16 h-16 rounded-2xl bg-surface-elevated border border-primary/25 flex items-center justify-center mb-5 z-10 group-hover:border-primary/60 group-hover:bg-primary/10 transition-all duration-300">
                <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary text-dark-900 text-xs font-bold flex items-center justify-center">2</span>
              </div>
              <h4 className="font-bold text-white mb-2 text-sm">Upload Your IDL</h4>
              <p className="text-xs text-gray-400 leading-relaxed">Drag and drop your Anchor IDL JSON. We validate, parse, and index every instruction and type.</p>
            </div>

            {/* Step 3 */}
            <div className="flex flex-col items-center text-center group">
              <div className="relative w-16 h-16 rounded-2xl bg-surface-elevated border border-primary/25 flex items-center justify-center mb-5 z-10 group-hover:border-primary/60 group-hover:bg-primary/10 transition-all duration-300">
                <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary text-dark-900 text-xs font-bold flex items-center justify-center">3</span>
              </div>
              <h4 className="font-bold text-white mb-2 text-sm">Build &amp; Send Transactions</h4>
              <p className="text-xs text-gray-400 leading-relaxed">POST accounts and args, get a base58 tx back. Sign with any wallet and broadcast to Solana.</p>
            </div>

            {/* Step 4 — MCP */}
            <div className="flex flex-col items-center text-center group">
              <div className="relative w-16 h-16 rounded-2xl bg-surface-elevated border border-secondary/25 flex items-center justify-center mb-5 z-10 group-hover:border-secondary/60 group-hover:bg-secondary/10 transition-all duration-300">
                <svg className="w-7 h-7 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-secondary text-dark-900 text-xs font-bold flex items-center justify-center">4</span>
              </div>
              <h4 className="font-bold text-white mb-2 text-sm">Connect Your AI Agent</h4>
              <p className="text-xs text-gray-400 leading-relaxed">Add the MCP endpoint to Claude, Cursor, or Copilot. Your agent can now build Solana transactions from prompts.</p>
            </div>
          </div>
        </div>
      </section>
  

      {/* Platform Section — One IDL, Every Platform */}
      <section className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <span className="badge badge-secondary text-xs mb-4 inline-block">Universal</span>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            <span className="text-white">One IDL. </span>
            <span className="gradient-text">Every Platform.</span>
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto leading-relaxed">
            Upload your Anchor IDL once. Orquestra handles Borsh serialization, Anchor discriminators,
            and transaction construction — any client, any language, any device can build Solana
            transactions with a single HTTP call. No SDK. No bundler. No complexity.
          </p>
        </div>

        {/* Platform cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="card p-5 space-y-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
            </div>
            <div>
              <h3 className="text-white font-semibold text-sm mb-1.5">Web Apps</h3>
              <p className="text-gray-500 text-xs leading-relaxed">
                React, Next.js, Vue, or vanilla JS. Call the API directly from any browser-based dApp without bundling a Solana SDK.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['React', 'Next.js', 'Vue', 'Svelte'].map((t) => (
                <span key={t} className="text-xs font-mono bg-surface-elevated border border-white/5 text-gray-400 px-2 py-0.5 rounded-md">{t}</span>
              ))}
            </div>
          </div>

          <div className="card p-5 space-y-4">
            <div className="w-10 h-10 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 className="text-white font-semibold text-sm mb-1.5">Mobile Apps</h3>
              <p className="text-gray-500 text-xs leading-relaxed">
                React Native, Swift, or Kotlin. Build transactions server-side and pass the base58 output to a mobile wallet for signing.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['React Native', 'Swift', 'Kotlin', 'Flutter'].map((t) => (
                <span key={t} className="text-xs font-mono bg-surface-elevated border border-white/5 text-gray-400 px-2 py-0.5 rounded-md">{t}</span>
              ))}
            </div>
          </div>

          <div className="card p-5 space-y-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4m0 0h18" />
              </svg>
            </div>
            <div>
              <h3 className="text-white font-semibold text-sm mb-1.5">IoT &amp; Embedded</h3>
              <p className="text-gray-500 text-xs leading-relaxed">
                Raspberry Pi, ESP32, or any device that can send HTTP. No heavy runtime — just a POST request and you're on-chain.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['MicroPython', 'C/C++', 'Rust', 'Go'].map((t) => (
                <span key={t} className="text-xs font-mono bg-surface-elevated border border-white/5 text-gray-400 px-2 py-0.5 rounded-md">{t}</span>
              ))}
            </div>
          </div>

          <div className="card p-5 space-y-4">
            <div className="w-10 h-10 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 className="text-white font-semibold text-sm mb-1.5">Backend &amp; CLI</h3>
              <p className="text-gray-500 text-xs leading-relaxed">
                Python scripts, Rust services, Go microservices, or shell pipelines. Automate on-chain operations from any server.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['Python', 'Rust', 'Go', 'Node.js'].map((t) => (
                <span key={t} className="text-xs font-mono bg-surface-elevated border border-white/5 text-gray-400 px-2 py-0.5 rounded-md">{t}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Hub connector bar */}
        <div className="card-static p-5 sm:p-6 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 text-center">
          <div>
            <p className="text-white font-semibold text-sm">Your Client</p>
            <p className="text-gray-500 text-xs mt-0.5">Web · Mobile · IoT · CLI</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:block w-12 h-px bg-gradient-to-r from-white/5 to-primary/50" />
            <svg className="w-4 h-4 text-primary/70 rotate-90 sm:rotate-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
            <div className="hidden sm:block w-12 h-px bg-gradient-to-r from-primary/50 to-secondary/50" />
          </div>

          <div>
            <div className="badge badge-primary text-xs font-bold px-4 py-1.5 mb-1 inline-block">Orquestra API</div>
            <p className="text-gray-500 text-xs">Build · Serialize · Discriminate</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:block w-12 h-px bg-gradient-to-r from-secondary/50 to-secondary/20" />
            <svg className="w-4 h-4 text-secondary/70 rotate-90 sm:rotate-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
            <div className="hidden sm:block w-12 h-px bg-gradient-to-r from-secondary/20 to-transparent" />
          </div>

          <div>
            <p className="text-secondary font-semibold text-sm">Solana Network</p>
            <p className="text-gray-500 text-xs mt-0.5">Mainnet · Devnet · Testnet</p>
          </div>
        </div>
      </section>

      {/* MCP / AI Agents Section */}
      <section className="max-w-6xl mx-auto px-6">
        <div className="card overflow-hidden">
          <div className="grid md:grid-cols-2 gap-0">
            {/* Left — copy */}
            <div className="p-8 md:p-10 flex flex-col justify-center gap-6">
              <div className="flex items-center gap-2">
                <span className="badge badge-secondary text-xs">New</span>
                <span className="text-gray-500 text-xs">Model Context Protocol</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-bold leading-snug">
                <span className="text-white">AI Agents Can Now</span>
                <br />
                <span className="gradient-text">Talk to Solana Programs</span>
              </h2>
              <p className="text-gray-400 text-sm leading-relaxed">
                Every public program in Orquestra is instantly accessible to Claude, Cursor, and GitHub Copilot
                via the Model Context Protocol. Your agent can search programs, inspect instructions,
                derive PDAs, and build unsigned transactions — all from a single prompt.
              </p>
              <ul className="space-y-3">
                {[
                  { label: 'search_programs', desc: 'Find any Solana program by name or ID' },
                  { label: 'build_instruction', desc: 'Build a base58 transaction ready for signing' },
                  { label: 'derive_pda', desc: 'Compute PDA addresses from seed values' },
                ].map(({ label, desc }) => (
                  <li key={label} className="flex items-start gap-3">
                    <span className="mt-0.5 w-2 h-2 rounded-full bg-secondary flex-shrink-0" />
                    <span className="text-sm text-gray-300">
                      <span className="font-mono text-secondary">{label}</span>
                      {' '}— {desc}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                to="/docs/mcp"
                className="btn-secondary text-sm px-5 py-2.5 w-fit"
              >
                Connect your AI agent →
              </Link>
            </div>

            {/* Right — code block */}
            <div className="bg-surface-elevated border-t md:border-t-0 md:border-l border-white/5 p-8 md:p-10 flex flex-col justify-center gap-4">
              <p className="text-xs text-gray-500 font-mono">claude_desktop_config.json</p>
              <pre className="text-xs font-mono leading-relaxed bg-dark-900 border border-white/5 rounded-xl p-4 overflow-x-auto text-gray-300 select-all">
{`{
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
              </pre>
              <p className="text-xs text-gray-600">
                Works with Claude Desktop, Cursor, VS Code Copilot, and any MCP-compatible client.
              </p>
            </div>
          </div>
        </div>
      </section>

       {/* Features Grid */}
      <section className="max-w-6xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">
          <span className="text-white">Everything you need to build </span>
          <span className="gradient-text">Solana dApps</span>
        </h2>
        <p className="text-center text-gray-400 mb-12 max-w-2xl mx-auto">
          From IDL to production API in minutes. Complete transaction building, type-safe documentation, 
          and developer tools that scale with your project.
        </p>
        
        <div className="grid md:grid-cols-3 gap-6">
          <div className="card p-6">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 mb-4">
              <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <h3 className="text-white font-bold text-lg mb-3">Instant IDL Parsing</h3>
            <p className="text-gray-400 leading-relaxed mb-3">
              Upload your Anchor IDL JSON and watch as we automatically extract every instruction, 
              account type, error code, and custom type definition.
            </p>
            <ul className="text-sm text-gray-500 space-y-1">
              <li>• Complete instruction analysis</li>
              <li>• Account type validation</li>
              <li>• Error code mapping</li>
              <li>• Custom type resolution</li>
            </ul>
          </div>
          
          <div className="card p-6">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 mb-4">
              <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            <h3 className="text-white font-bold text-lg mb-3">Base58 Transaction Builder</h3>
            <p className="text-gray-400 leading-relaxed mb-3">
              Build fully-formed Solana transactions via REST API. Returns base58-encoded transactions 
              ready for wallet signing and submission to the network.
            </p>
            <ul className="text-sm text-gray-500 space-y-1">
              <li>• Borsh serialization handled</li>
              <li>• Anchor discriminators computed</li>
              <li>• Wallet-ready base58 output</li>
              <li>• No client-side IDL needed</li>
            </ul>
          </div>
          
          <div className="card p-6">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 mb-4">
              <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-white font-bold text-lg mb-3">AI-Optimized Documentation</h3>
            <p className="text-gray-400 leading-relaxed mb-3">
              Auto-generated Markdown documentation formatted for AI agents and LLMs. 
              Complete with type definitions, examples, and usage patterns.
            </p>
            <ul className="text-sm text-gray-500 space-y-1">
              <li>• Structured Markdown format</li>
              <li>• LLM context-optimized</li>
              <li>• Complete API reference</li>
              <li>• Type-safe examples included</li>
            </ul>
          </div>

          <div className="card p-6">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 mb-4">
              <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h3 className="text-white font-bold text-lg mb-3">Secure API Keys</h3>
            <p className="text-gray-400 leading-relaxed mb-3">
              Generate and manage API keys for your projects. Control access, monitor usage, 
              and rotate keys with full audit trails.
            </p>
            <ul className="text-sm text-gray-500 space-y-1">
              <li>• Per-project API keys</li>
              <li>• Usage analytics</li>
              <li>• Rate limiting built-in</li>
              <li>• Easy key rotation</li>
            </ul>
          </div>

          <div className="card p-6">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 mb-4">
              <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </div>
            <h3 className="text-white font-bold text-lg mb-3">Developer-First API</h3>
            <p className="text-gray-400 leading-relaxed mb-3">
              RESTful endpoints with predictable structure. Works with any HTTP client, 
              language, or framework. No SDK dependencies required.
            </p>
            <ul className="text-sm text-gray-500 space-y-1">
              <li>• Standard REST conventions</li>
              <li>• JSON request/response</li>
              <li>• Works with curl, fetch, axios</li>
              <li>• Language agnostic</li>
            </ul>
          </div>

          <div className="card p-6">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 mb-4">
              <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-white font-bold text-lg mb-3">Cloudflare Edge Infrastructure</h3>
            <p className="text-gray-400 leading-relaxed mb-3">
              Deployed on Cloudflare Workers with global edge caching. 
              Lightning-fast response times from anywhere in the world.
            </p>
            <ul className="text-sm text-gray-500 space-y-1">
              <li>• Sub-50ms latency globally</li>
              <li>• Automatic scaling</li>
              <li>• 99.99% uptime SLA</li>
              <li>• DDoS protection included</li>
            </ul>
          </div>
        </div>
      </section>

    </div>
  )
}
