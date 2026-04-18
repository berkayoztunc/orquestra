import { useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'

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
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-gray-400 hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-all duration-200 select-none"
      title="Copy"
    >
      {copied ? (
        <>
          <CheckIcon className="w-3.5 h-3.5" />
          Copied
        </>
      ) : (
        <>
          <CopyIcon className="w-3.5 h-3.5" />
          Copy
        </>
      )}
    </button>
  )
}

const FEATURES = [
  {
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    ),
    title: 'Interactive Run',
    desc: 'Fuzzy-select an instruction, answer per-arg prompts, and execute — all from one command.',
    bullets: ['Fuzzy instruction picker', 'Per-argument prompts', 'Auto-fills signer accounts', 'Sign & send in one step'],
  },
  {
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
      />
    ),
    title: 'PDA Derivation',
    desc: 'Fuzzy-select a PDA account, enter seed values, and instantly derive the address and bump.',
    bullets: ['Reads PDA seeds from IDL', 'Supports all seed types', 'Shows derived address & bump', 'Auto-resolves known PDAs'],
  },
  {
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
      />
    ),
    title: 'Local IDL File Mode',
    desc: 'Point the CLI at any Anchor IDL JSON file and operate fully offline — no Orquestra account needed.',
    bullets: ['Works with anchor build output', 'No account or API key required', 'Supports all primitive Borsh types', 'Switch modes with one flag'],
  },
  {
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
      />
    ),
    title: 'Keypair Integration',
    desc: 'Loads your standard Solana CLI keypair to pre-fill signer accounts and sign transactions locally.',
    bullets: ['Standard JSON keypair format', 'Auto-fills signer accounts', 'Sign & broadcast in one step', 'Keypair-free unsigned mode'],
  },
  {
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
      />
    ),
    title: 'Instruction List',
    desc: 'Quickly view all instructions in your program with a single command.',
    bullets: ['Displays all instructions', 'Shows descriptions from IDL', 'Works in both modes', 'Fast read-only lookup'],
  },
  {
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    ),
    title: 'Persistent Config',
    desc: 'Settings are stored in ~/.config/orquestra/config.toml and reused across sessions.',
    bullets: ['Stored in XDG config dir', 'Set once, reuse everywhere', 'Supports multiple projects', 'Easy reset & update'],
  },
]

export default function CLI(): JSX.Element {
  return (
    <div className="animate-fade-in space-y-12">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="badge badge-primary text-xs">Docs</span>
          <span className="text-gray-600 text-xs">/</span>
          <span className="text-gray-400 text-xs font-mono">cli</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold">
          <span className="gradient-text">CLI</span>{' '}
          <span className="text-white">Reference</span>
        </h1>

        <p className="text-gray-400 max-w-2xl leading-relaxed">
          A fast Rust CLI for interacting with Solana programs via IDL. Upload your Anchor IDL to
          Orquestra once — or point the CLI at a local IDL file — and turn every instruction into an
          interactive prompt that builds, signs, and sends transactions to Solana.
        </p>

        <div className="flex flex-wrap gap-3">
          <a
            href="https://github.com/berkayoztunc/orquestra-cli/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary text-sm px-5 py-2.5"
          >
            Download Latest Release
          </a>
          <a
            href="https://github.com/berkayoztunc/orquestra-cli"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-sm px-5 py-2.5"
          >
            View on GitHub
          </a>
        </div>
      </div>

      {/* Features */}
      <div className="card p-5 sm:p-6 space-y-4">
        <h2 className="text-xl sm:text-2xl font-bold text-white">Features</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(({ icon, title, desc, bullets }) => (
            <div key={title} className="bg-surface-elevated border border-white/5 rounded-xl p-4">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 mb-3">
                <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {icon}
                </svg>
              </div>
              <p className="text-white font-semibold text-sm mb-1">{title}</p>
              <p className="text-gray-500 text-xs leading-relaxed mb-2">{desc}</p>
              <ul className="text-xs text-gray-600 space-y-0.5">
                {bullets.map((b) => (
                  <li key={b}>• {b}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Installation */}
      <div className="card p-5 sm:p-6 space-y-4">
        <h2 className="text-xl sm:text-2xl font-bold text-white">Installation</h2>

        {/* Homebrew */}
        <div className="bg-surface-elevated border border-white/5 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs">
              1
            </div>
            <p className="text-white font-semibold text-sm">
              Homebrew <span className="text-gray-500 font-normal">(macOS — recommended)</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-500 font-mono">brew</p>
            <CopyButton text={`brew tap berkayoztunc/orquestra-cli https://github.com/berkayoztunc/orquestra-cli\nbrew install orquestra-cli`} />
          </div>
          <pre className="text-xs sm:text-sm font-mono leading-relaxed bg-dark-900 border border-white/5 rounded-xl p-4 overflow-x-auto text-gray-300">
            <span className="text-gray-500"># Add the tap{'\n'}</span>
            brew tap berkayoztunc/orquestra-cli https://github.com/berkayoztunc/orquestra-cli{'\n'}
            brew install orquestra-cli
          </pre>
        </div>

        {/* Binary */}
        <div className="bg-surface-elevated border border-white/5 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs">
              2
            </div>
            <p className="text-white font-semibold text-sm">
              Download binary <span className="text-gray-500 font-normal">(all platforms)</span>
            </p>
          </div>
          <p className="text-gray-500 text-xs">
            Grab the latest binary from the{' '}
            <a
              href="https://github.com/berkayoztunc/orquestra-cli/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Releases page
            </a>
            :
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-gray-500 font-medium py-2 pr-6">Platform</th>
                  <th className="text-gray-500 font-medium py-2">Archive</th>
                </tr>
              </thead>
              <tbody className="font-mono text-gray-400">
                {[
                  ['macOS arm64', 'orquestra-vX.X.X-aarch64-apple-darwin.tar.gz'],
                  ['macOS x86_64', 'orquestra-vX.X.X-x86_64-apple-darwin.tar.gz'],
                  ['Linux x86_64', 'orquestra-vX.X.X-x86_64-unknown-linux-gnu.tar.gz'],
                  ['Linux arm64', 'orquestra-vX.X.X-aarch64-unknown-linux-gnu.tar.gz'],
                ].map(([platform, archive]) => (
                  <tr key={platform} className="border-b border-white/5">
                    <td className="text-gray-500 font-sans py-2 pr-6">{platform}</td>
                    <td className="py-2">{archive}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <pre className="text-xs sm:text-sm font-mono leading-relaxed bg-dark-900 border border-white/5 rounded-xl p-4 overflow-x-auto text-gray-300">
            tar -xzf orquestra-*.tar.gz{'\n'}
            mv orquestra /usr/local/bin/
          </pre>
        </div>

        {/* Build from source */}
        <div className="bg-surface-elevated border border-white/5 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs">
              3
            </div>
            <p className="text-white font-semibold text-sm">
              Build from source <span className="text-gray-500 font-normal">(Rust 1.75+)</span>
            </p>
          </div>
          <pre className="text-xs sm:text-sm font-mono leading-relaxed bg-dark-900 border border-white/5 rounded-xl p-4 overflow-x-auto text-gray-300">
            git clone https://github.com/berkayoztunc/orquestra-cli{'\n'}
            cd orquestra-cli{'\n'}
            cargo build --release{'\n'}
            <span className="text-gray-500"># binary → target/release/orquestra</span>
          </pre>
        </div>
      </div>

      {/* Setup */}
      <div className="card p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-1">Setup</h2>
          <p className="text-sm text-gray-400">Two operating modes — pick the one that fits your workflow.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-surface-elevated border border-primary/20 rounded-xl p-4">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
              </svg>
            </div>
            <p className="text-white font-semibold text-sm mb-1">
              API mode <span className="text-primary text-xs font-normal">(default)</span>
            </p>
            <p className="text-gray-500 text-xs leading-relaxed">
              You have an Orquestra account and API key. All instruction metadata is fetched from the cloud.
            </p>
          </div>
          <div className="bg-surface-elevated border border-white/5 rounded-xl p-4">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
            </div>
            <p className="text-white font-semibold text-sm mb-1">Local IDL file mode</p>
            <p className="text-gray-500 text-xs leading-relaxed">
              You have an Anchor IDL JSON file locally. Works fully offline — no Orquestra account needed.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="bg-surface-elevated border border-white/5 rounded-xl p-4 space-y-3">
            <p className="text-white font-semibold text-sm">API mode config</p>
            <pre className="text-xs sm:text-sm font-mono leading-relaxed bg-dark-900 border border-white/5 rounded-xl p-4 overflow-x-auto text-gray-300">
              orquestra config set \{'\n'}
              {'  '}--project-id &lt;your-project-id&gt; \{'\n'}
              {'  '}--api-key    &lt;your-api-key&gt;    \{'\n'}
              {'  '}--rpc        https://api.mainnet-beta.solana.com \{'\n'}
              {'  '}--keypair    ~/.config/solana/id.json
            </pre>
            <p className="text-gray-500 text-xs">
              Sign in at{' '}
              <a href="/" className="text-primary hover:underline">
                orquestra.dev
              </a>
              , upload your Anchor IDL, and generate an API key from the dashboard.
            </p>
          </div>

          <div className="bg-surface-elevated border border-white/5 rounded-xl p-4 space-y-3">
            <p className="text-white font-semibold text-sm">Local IDL file mode config</p>
            <pre className="text-xs sm:text-sm font-mono leading-relaxed bg-dark-900 border border-white/5 rounded-xl p-4 overflow-x-auto text-gray-300">
              orquestra config set \{'\n'}
              {'  '}--idl     /path/to/program.json \{'\n'}
              {'  '}--rpc     https://api.mainnet-beta.solana.com \{'\n'}
              {'  '}--keypair ~/.config/solana/id.json
            </pre>
            <p className="text-gray-500 text-xs">
              When <code className="text-gray-300 bg-white/5 px-1 rounded">idl_path</code> is set the CLI
              operates in file mode. To switch back:{' '}
              <code className="text-gray-300 bg-white/5 px-1 rounded">orquestra config set --idl ""</code>
            </p>
          </div>
        </div>
      </div>

      {/* Usage */}
      <div className="card p-5 sm:p-6 space-y-4">
        <h2 className="text-xl sm:text-2xl font-bold text-white">Usage examples</h2>

        <div className="space-y-4">
          <div className="bg-surface-elevated border border-white/5 rounded-xl p-4 space-y-2">
            <p className="text-white font-semibold text-sm">List instructions</p>
            <pre className="text-xs sm:text-sm font-mono leading-relaxed bg-dark-900 border border-white/5 rounded-xl p-4 overflow-x-auto text-gray-300">
              orquestra list{'\n\n'}
              <span className="text-primary">▸ 4 instructions in my-program{'\n\n'}</span>
              {'  '}initialize    Initializes a new vault account{'\n'}
              {'  '}deposit       Deposit tokens into the vault{'\n'}
              {'  '}withdraw      Withdraw tokens from the vault{'\n'}
              {'  '}close         Close the vault and reclaim rent
            </pre>
          </div>

          <div className="bg-surface-elevated border border-white/5 rounded-xl p-4 space-y-2">
            <p className="text-white font-semibold text-sm">Run an instruction (interactive)</p>
            <pre className="text-xs sm:text-sm font-mono leading-relaxed bg-dark-900 border border-white/5 rounded-xl p-4 overflow-x-auto text-gray-300">
              orquestra run{'\n\n'}
              <span className="text-gray-500">? Select instruction  › deposit{'\n\n'}</span>
              Instruction: deposit{'\n\n'}
              Arguments{'\n'}
              {'  '}amount (u64): 1000000{'\n\n'}
              Accounts{'\n'}
              {'  '}authority [signer]: Gk3...abc  <span className="text-gray-500">(pre-filled from keypair)</span>{'\n'}
              {'  '}vault [mut]:        Fv9...xyz{'\n\n'}
              ────────────────────────────────────────{'\n'}
              Summary{'\n'}
              {'  '}Instruction : deposit{'\n'}
              {'  '}Args        : amount = 1000000{'\n'}
              {'  '}Accounts    : authority = Gk3...abc / vault = Fv9...xyz{'\n'}
              ────────────────────────────────────────{'\n\n'}
              <span className="text-gray-500">? Build transaction for 'deposit'? › Yes{'\n\n'}</span>
              <span className="text-green-400">✓ Transaction built successfully!{'\n'}</span>
              {'  '}Estimated fee : 5000 lamports{'\n\n'}
              <span className="text-gray-500">? Sign and send transaction to Solana? › Yes{'\n\n'}</span>
              <span className="text-green-400">✓ Transaction confirmed!{'\n'}</span>
              {'  '}Signature : 5KtP...Xz{'\n'}
              {'  '}Explorer  : https://explorer.solana.com/tx/5KtP...Xz
            </pre>
          </div>

          <div className="bg-surface-elevated border border-white/5 rounded-xl p-4 space-y-2">
            <p className="text-white font-semibold text-sm">Derive a PDA</p>
            <pre className="text-xs sm:text-sm font-mono leading-relaxed bg-dark-900 border border-white/5 rounded-xl p-4 overflow-x-auto text-gray-300">
              orquestra pda{'\n\n'}
              <span className="text-primary">▸ 2 PDA accounts in my-program (BUYu...){'\n\n'}</span>
              <span className="text-gray-500">? Select PDA account  › vault (owner){'\n\n'}</span>
              Seed values{'\n'}
              {'  '}owner (publicKey): Gk3...abc{'\n\n'}
              <span className="text-green-400">✓ PDA derived!{'\n\n'}</span>
              {'  '}Address:   Fv9...xyz{'\n'}
              {'  '}Bump:      254{'\n'}
              {'  '}Program:   BUYu...{'\n\n'}
              Seeds:{'\n'}
              {'  '}const  vault_seed  [76617...]{'\n'}
              {'  '}arg    owner       = Gk3...abc [0a1b...]
            </pre>
          </div>

          <div className="bg-surface-elevated border border-white/5 rounded-xl p-4 space-y-2">
            <p className="text-white font-semibold text-sm">Without a keypair</p>
            <p className="text-gray-500 text-xs">
              If no keypair is configured, the CLI prints an unsigned base58 transaction for manual wallet signing.
            </p>
            <pre className="text-xs sm:text-sm font-mono leading-relaxed bg-dark-900 border border-white/5 rounded-xl p-4 overflow-x-auto text-gray-300">
              Base58 encoded transaction (unsigned):{'\n'}
              {'  '}4h8nK3F9x2rP...vQm7L2wN{'\n\n'}
              {'  '}Sign with your wallet and broadcast to Solana.{'\n'}
              {'  '}https://orquestra.dev/docs/sign-and-send
            </pre>
          </div>
        </div>
      </div>

      {/* Command reference */}
      <div className="card p-5 sm:p-6 space-y-4" id="commands">
        <h2 className="text-xl sm:text-2xl font-bold text-white">Command reference</h2>
        <pre className="text-xs sm:text-sm font-mono leading-loose bg-surface-elevated border border-white/5 rounded-xl p-4 overflow-x-auto text-gray-300">
          <span className="text-gray-500"># Interactive top-level menu{'\n'}</span>
          orquestra{'\n\n'}
          <span className="text-gray-500"># Instructions{'\n'}</span>
          orquestra list{'\n'}
          orquestra run [INSTRUCTION]{'\n\n'}
          <span className="text-gray-500"># PDAs{'\n'}</span>
          orquestra pda [ACCOUNT]{'\n\n'}
          <span className="text-gray-500"># Config{'\n'}</span>
          orquestra config set [--project-id] [--api-key] [--rpc] [--keypair] [--api-base] [--idl]{'\n'}
          orquestra config show{'\n'}
          orquestra config reset{'\n\n'}
          <span className="text-gray-500"># Meta{'\n'}</span>
          orquestra --version{'\n'}
          orquestra --help
        </pre>
      </div>

      {/* Security note */}
      <div className="card-static p-5 border border-yellow-500/20 bg-yellow-500/5">
        <p className="text-sm text-gray-300 leading-relaxed">
          <span className="text-yellow-300 font-semibold">This project has not been audited.</span>{' '}
          Use a <strong className="text-yellow-300">test wallet</strong> with minimal funds when signing
          and sending transactions. Do <em>not</em> use a wallet that holds significant assets until a
          full security audit has been completed. You are responsible for any transactions you sign and
          broadcast to the network.
        </p>
      </div>
    </div>
  )
}

