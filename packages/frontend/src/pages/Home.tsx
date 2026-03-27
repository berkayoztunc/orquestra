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
          
          <p className="text-xl text-gray-400 mb-6 max-w-2xl mx-auto leading-relaxed">
            Transform your Anchor programs into production-ready REST APIs instantly. 
            No backend code, no infrastructure setup, no deployment hassles.
          </p>
          
          <p className="text-lg text-gray-500 mb-10 max-w-xl mx-auto">
            Just upload your IDL and get automatic transaction building, wallet-ready base58 serialization, 
            and AI-optimized documentation for every instruction and account type.
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
              Explore APIs
            </Link>
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
            <p className="text-gray-600 text-xs mt-0.5">Web · Mobile · IoT · CLI</p>
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
            <p className="text-gray-600 text-xs">Build · Serialize · Discriminate</p>
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
            <p className="text-gray-600 text-xs mt-0.5">Mainnet · Devnet · Testnet</p>
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
            From zero to production-ready Solana API in four steps. No backend code, no devops,
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
              <p className="text-xs text-gray-500 leading-relaxed">OAuth in one click. No passwords, no forms. Your projects are ready immediately.</p>
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
              <p className="text-xs text-gray-500 leading-relaxed">Drag and drop your Anchor IDL JSON. We validate, parse, and index every instruction and type.</p>
            </div>

            {/* Step 3 */}
            <div className="flex flex-col items-center text-center group">
              <div className="relative w-16 h-16 rounded-2xl bg-surface-elevated border border-primary/25 flex items-center justify-center mb-5 z-10 group-hover:border-primary/60 group-hover:bg-primary/10 transition-all duration-300">
                <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary text-dark-900 text-xs font-bold flex items-center justify-center">3</span>
              </div>
              <h4 className="font-bold text-white mb-2 text-sm">Get Your API Key</h4>
              <p className="text-xs text-gray-500 leading-relaxed">Your endpoints go live instantly. Generate a key from the dashboard and start making requests.</p>
            </div>

            {/* Step 4 */}
            <div className="flex flex-col items-center text-center group">
              <div className="relative w-16 h-16 rounded-2xl bg-surface-elevated border border-primary/25 flex items-center justify-center mb-5 z-10 group-hover:border-primary/60 group-hover:bg-primary/10 transition-all duration-300">
                <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary text-dark-900 text-xs font-bold flex items-center justify-center">4</span>
              </div>
              <h4 className="font-bold text-white mb-2 text-sm">Build &amp; Send Transactions</h4>
              <p className="text-xs text-gray-500 leading-relaxed">POST accounts and args, get a base58 tx back. Sign with any wallet and broadcast to Solana.</p>
            </div>
          </div>
        </div>
      </section>

      {/* API Examples */}
      <section className="max-w-6xl mx-auto px-6 pb-5">
        <h2 className="text-3xl font-bold text-center mb-4">
          <span className="text-white">API </span>
          <span className="gradient-text">Examples</span>
        </h2>
        <p className="text-center text-gray-400 mb-12 max-w-2xl mx-auto">
          Simple REST API calls for everything. From discovering instructions to building 
          complete transactions ready for wallet signing.
        </p>
        
        <div className="space-y-6">
          {/* Example 1: List Instructions */}
          <div className="card-static p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">List All Instructions</h3>
              <span className="badge badge-primary">GET</span>
            </div>
            <p className="text-gray-400 text-sm mb-4">
              Discover all available instructions from your program's IDL with their parameters and account requirements.
            </p>
            <div className="card p-4 bg-dark-900/50">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-red-500/50" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                <div className="w-3 h-3 rounded-full bg-green-500/50" />
                <span className="ml-4 text-xs text-gray-500 font-mono">bash</span>
              </div>
              <pre className="text-sm text-gray-300 font-mono overflow-x-auto">
{`curl https://api.orquestra.dev/api/{projectId}/instructions \\
  -H "X-API-Key: your_api_key_here"`}
              </pre>
            </div>
          </div>

          {/* Example 2: Get Instruction Details */}
          <div className="card-static p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">Get Instruction Details</h3>
              <span className="badge badge-primary">GET</span>
            </div>
            <p className="text-gray-400 text-sm mb-4">
              Get detailed information about a specific instruction including all arguments, account requirements, and type definitions.
            </p>
            <div className="card p-4 bg-dark-900/50">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-red-500/50" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                <div className="w-3 h-3 rounded-full bg-green-500/50" />
                <span className="ml-4 text-xs text-gray-500 font-mono">bash</span>
              </div>
              <pre className="text-sm text-gray-300 font-mono overflow-x-auto">
{`curl https://api.orquestra.dev/api/{projectId}/instructions/initialize \\
  -H "X-API-Key: your_api_key_here"`}
              </pre>
            </div>
            <div className="mt-4 card p-4 bg-primary/5 border border-primary/20">
              <p className="text-sm text-primary mb-2">
                <strong>Response:</strong> Instruction Details
              </p>
              <pre className="text-xs text-gray-400 font-mono overflow-x-auto">
{`{
  "projectId": "proj_abc123",
  "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "instruction": {
    "name": "initialize",
    "docs": ["Initializes a new account"],
    "accounts": [
      {
        "name": "account",
        "isMut": true,
        "isSigner": false,
        "isOptional": false,
        "pda": null
      }
    ],
    "args": [
      {
        "name": "amount",
        "type": "u64",
        "defaultValue": 0
      }
    ]
  }
}`}
              </pre>
            </div>
          </div>

          {/* Example 3: Build Transaction */}
          <div className="card-static p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">Build a Transaction</h3>
              <span className="badge bg-green-500/15 text-green-400">POST</span>
            </div>
            <p className="text-gray-400 text-sm mb-4">
              Build a complete Solana transaction by providing accounts and instruction arguments. 
              Returns a base58-encoded transaction ready for wallet signing.
            </p>
            <div className="card p-4 bg-dark-900/50">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-red-500/50" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                <div className="w-3 h-3 rounded-full bg-green-500/50" />
                <span className="ml-4 text-xs text-gray-500 font-mono">bash</span>
              </div>
              <pre className="text-sm text-gray-300 font-mono overflow-x-auto">
{`curl -X POST https://api.orquestra.dev/api/{projectId}/instructions/transfer/build \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: your_api_key_here" \\
  -d '{
    "accounts": {
      "from": "SENDER_WALLET_PUBKEY",
      "to": "RECIPIENT_WALLET_PUBKEY",
      "systemProgram": "11111111111111111111111111111111"
    },
    "args": {
      "amount": 1000000
    },
    "feePayer": "SENDER_WALLET_PUBKEY",
    "network": "devnet"
  }'`}
              </pre>
            </div>
            <div className="mt-4 card p-4 bg-primary/5 border border-primary/20">
              <p className="text-sm text-primary mb-2">
                <strong>Response:</strong> Base58 Encoded Transaction
              </p>
              <pre className="text-xs text-gray-400 font-mono overflow-x-auto">
{`{
  "transaction": "4h8nK3F9x2rP...vQm7L2wN",
  "message": "Transaction for my_program.transfer",
  "accounts": [
    {
      "name": "from",
      "pubkey": "SENDER_WALLET_PUBKEY",
      "isSigner": true,
      "isWritable": true
    },
    {
      "name": "to",
      "pubkey": "RECIPIENT_WALLET_PUBKEY",
      "isSigner": false,
      "isWritable": true
    }
  ],
  "instruction": {
    "name": "transfer",
    "programId": "YOUR_PROGRAM_ID",
    "data": "a1b2c3d4...",
    "accounts": [...]
  },
  "estimatedFee": 5000
}`}
              </pre>
            </div>
          </div>

          {/* Example 4: Query Account Data */}
          <div className="card-static p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">Get Account Schemas</h3>
              <span className="badge badge-primary">GET</span>
            </div>
            <p className="text-gray-400 text-sm mb-4">
              Retrieve schemas for all account types defined in your IDL. Perfect for validating data structures.
            </p>
            <div className="card p-4 bg-dark-900/50">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-red-500/50" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                <div className="w-3 h-3 rounded-full bg-green-500/50" />
                <span className="ml-4 text-xs text-gray-500 font-mono">bash</span>
              </div>
              <pre className="text-sm text-gray-300 font-mono overflow-x-auto">
{`curl https://api.orquestra.dev/api/{projectId}/accounts \\
  -H "X-API-Key: your_api_key_here"`}
              </pre>
            </div>
            <div className="mt-4 card p-4 bg-primary/5 border border-primary/20">
              <p className="text-sm text-primary mb-2">
                <strong>Response:</strong> Account Schemas
              </p>
              <pre className="text-xs text-gray-400 font-mono overflow-x-auto">
{`{
  "projectId": "proj_abc123",
  "programName": "my_program",
  "accounts": [
    {
      "name": "UserAccount",
      "kind": "struct",
      "docs": ["User account state"],
      "discriminator": [1, 2, 3, 4, 5, 6, 7, 8],
      "fields": [
        { "name": "owner", "type": "publicKey" },
        { "name": "balance", "type": "u64" }
      ]
    }
  ]
}`}
              </pre>
            </div>
          </div>

          {/* Example 5: Compute PDA */}
          <div className="card-static p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">Compute Program Derived Address</h3>
              <span className="badge bg-green-500/15 text-green-400">POST</span>
            </div>
            <p className="text-gray-400 text-sm mb-4">
              Calculate Program Derived Addresses (PDAs) based on instruction requirements. Essential for working with Anchor programs.
            </p>
            <div className="card p-4 bg-dark-900/50">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-red-500/50" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                <div className="w-3 h-3 rounded-full bg-green-500/50" />
                <span className="ml-4 text-xs text-gray-500 font-mono">bash</span>
              </div>
              <pre className="text-sm text-gray-300 font-mono overflow-x-auto">
{`curl -X POST https://api.orquestra.dev/api/{projectId}/pda/derive \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: your_api_key_here" \\
  -d '{
    "instruction": "initialize",
    "account": "userAccount",
    "seedValues": {
      "authority": "USER_WALLET_PUBKEY"
    }
  }'`}
              </pre>
            </div>
            <div className="mt-4 card p-4 bg-primary/5 border border-primary/20">
              <p className="text-sm text-primary mb-2">
                <strong>Response:</strong> PDA Details
              </p>
              <pre className="text-xs text-gray-400 font-mono overflow-x-auto">
{`{
  "pda": "COMPUTED_PDA_ADDRESS",
  "bump": 254,
  "programId": "YOUR_PROGRAM_ID",
  "seeds": [
    {
      "kind": "const",
      "description": "user_account",
      "hex": "757365725f6163636f756e74"
    },
    {
      "kind": "account",
      "name": "authority",
      "value": "USER_WALLET_PUBKEY",
      "hex": "a1b2c3..."
    }
  ]
}`}
              </pre>
            </div>
          </div>

          {/* Example 6: Get Documentation */}
          <div className="card-static p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">Download AI Documentation</h3>
              <span className="badge badge-primary">GET</span>
            </div>
            <p className="text-gray-400 text-sm mb-4">
              Get auto-generated Markdown documentation optimized for AI agents and LLMs. 
              Complete with all instructions, types, and usage examples.
            </p>
            <div className="card p-4 bg-dark-900/50">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-red-500/50" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                <div className="w-3 h-3 rounded-full bg-green-500/50" />
                <span className="ml-4 text-xs text-gray-500 font-mono">bash</span>
              </div>
              <pre className="text-sm text-gray-300 font-mono overflow-x-auto">
{`# Get as Markdown
curl https://api.orquestra.dev/api/{projectId}/docs?format=markdown \\
  -H "X-API-Key: your_api_key_here" \\
  -o program_docs.md

# Get as JSON with sections
curl https://api.orquestra.dev/api/{projectId}/docs \\
  -H "X-API-Key: your_api_key_here"`}
              </pre>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center mt-12">
          <p className="text-gray-400 mb-6">
            Ready to start building with Solana?
          </p>
          <div className="flex justify-center gap-4">
            {isAuthenticated ? (
              <Link to="/dashboard" className="btn-primary">
                Go to Dashboard
              </Link>
            ) : (
              <a href={getGitHubLoginUrl()} className="btn-primary">
                Get Started Free
              </a>
            )}
            <a 
              href="https://github.com/berkayoztunc/orquestra" 
              target="_blank" 
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
