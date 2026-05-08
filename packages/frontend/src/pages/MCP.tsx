import { useState } from 'react'
import {
  CheckIcon,
  CopyIcon,
  BookOpenIcon,
  BotIcon,
  DatabaseIcon,
  SearchIcon,
  ListIcon,
  ZapIcon,
  MapPinIcon,
  KeyIcon,
  FileTextIcon,
  SparklesIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import CodeBlock from '../components/CodeBlock'

type Client = 'claude' | 'claude-code' | 'cursor' | 'vscode'

const MCP_ENDPOINT = 'https://api.orquestra.dev/mcp'

const CLIENT_CONFIGS: Record<Client, { label: string; badge: string; filename: string; hint: string; config: string }> = {
  claude: {
    label: 'Claude Desktop',
    badge: 'CD',
    filename: '~/Library/Application Support/Claude/claude_desktop_config.json',
    hint: 'Save, then fully restart Claude Desktop to reload MCP servers.',
    config: JSON.stringify(
      {
        mcpServers: {
          orquestra: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/client-streamable-http', MCP_ENDPOINT],
          },
        },
      },
      null,
      2,
    ),
  },
  'claude-code': {
    label: 'Claude Code',
    badge: 'CC',
    filename: '.claude/settings.json (project) or ~/.claude/settings.json (global)',
    hint: 'Run `/mcp` in Claude Code to confirm the orquestra server is connected. The streamable HTTP transport works with no local install.',
    config: JSON.stringify(
      {
        mcpServers: {
          orquestra: {
            type: 'http',
            url: MCP_ENDPOINT,
          },
        },
      },
      null,
      2,
    ),
  },
  cursor: {
    label: 'Cursor',
    badge: 'CU',
    filename: '.cursor/mcp.json (project) or ~/.cursor/mcp.json (global)',
    hint: 'Save and reload window to make tools available in your agent panel.',
    config: JSON.stringify(
      {
        mcpServers: {
          orquestra: {
            url: MCP_ENDPOINT,
          },
        },
      },
      null,
      2,
    ),
  },
  vscode: {
    label: 'VS Code (GitHub Copilot)',
    badge: 'VS',
    filename: '.vscode/mcp.json (project) or user-level MCP settings',
    hint: 'Reload VS Code and check the Copilot MCP panel for Orquestra server status.',
    config: JSON.stringify(
      {
        servers: {
          orquestra: {
            type: 'http',
            url: MCP_ENDPOINT,
          },
        },
      },
      null,
      2,
    ),
  },
}

const STEPS = [
  {
    icon: <SearchIcon className="w-5 h-5 text-primary" />,
    title: 'Discover a Program',
    desc: 'Use search_programs to find public Solana projects by keyword or exact program ID.',
  },
  {
    icon: <ListIcon className="w-5 h-5 text-secondary" />,
    title: 'Inspect and Prepare',
    desc: 'Call list_instructions, list_pda_accounts, and derive_pda to gather exact call inputs.',
  },
  {
    icon: <ZapIcon className="w-5 h-5 text-primary" />,
    title: 'Build Transactions',
    desc: 'Use build_instruction to get a base58 unsigned transaction your app or wallet can sign.',
  },
  {
    icon: <DatabaseIcon className="w-5 h-5 text-secondary" />,
    title: 'Query Program Data',
    desc: 'Call get_program_data to search program-owned accounts with accountType, dataSize, memcmp, and fixed IDL field filters.',
  },
]

const TOOLS = [
  {
    icon: SearchIcon,
    name: 'search_programs',
    desc: 'Search public projects in Orquestra by keyword or by exact program ID.',
  },
  {
    icon: ListIcon,
    name: 'list_instructions',
    desc: 'List all instructions, args, and account metas for a project.',
  },
  {
    icon: ZapIcon,
    name: 'build_instruction',
    desc: 'Build and serialize a Solana instruction transaction into base58.',
  },
  {
    icon: MapPinIcon,
    name: 'list_pda_accounts',
    desc: 'Show PDA-derivable accounts and seed schemas from the IDL.',
  },
  {
    icon: KeyIcon,
    name: 'derive_pda',
    desc: 'Derive a PDA with your provided seed values and return bump.',
  },
  {
    icon: FileTextIcon,
    name: 'read_llms_txt',
    desc: 'Read full AI-focused markdown docs for a selected project.',
  },
  {
    icon: SparklesIcon,
    name: 'get_ai_analysis',
    desc: 'Get AI analysis summary, tags, and metadata for a project.',
  },
  {
    icon: DatabaseIcon,
    name: 'fetch_pda_data',
    desc: 'Fetch a Solana account by address and decode its fields using the project IDL. Accepts an optional cluster param (mainnet-beta · devnet · testnet).',
  },
  {
    icon: DatabaseIcon,
    name: 'get_program_data',
    desc: 'Query getProgramAccounts for a project program ID. Supports accountType discriminator filters, dataSize, raw memcmp filters, fixed-field IDL filters, decoded results, and optional raw base64.',
  },
  {
    icon: ShieldCheckIcon,
    name: 'simulate_instruction',
    desc: 'Preflight an instruction against the RPC without signing. Returns success/failure, compute units, and a decoded Anchor error name when a custom program error is hit. Use before signing to catch mistakes early.',
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

export default function MCP(): JSX.Element {
  const [client, setClient] = useState<Client>('claude')
  const current = CLIENT_CONFIGS[client]

  return (
    <div className="animate-fade-in space-y-12">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="badge badge-primary text-xs">Docs</span>
          <span className="text-gray-600 text-xs">/</span>
          <span className="text-gray-400 text-xs font-mono">mcp-server</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold">
          <span className="gradient-text">MCP Server</span>{' '}
          <span className="text-white">Integration Guide</span>
        </h1>

        <p className="text-gray-400 max-w-2xl leading-relaxed">
          Connect Orquestra to any MCP-capable assistant and let your agent inspect Solana IDLs,
          derive PDAs, fetch live on-chain account data, and build unsigned transactions directly from prompts.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {STEPS.map((step, i) => (
          <div key={step.title} className="card p-5 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-surface-elevated border border-white/5 flex items-center justify-center flex-shrink-0">
                {step.icon}
              </div>
              <span className="text-xs text-gray-600 font-mono">step {i + 1}</span>
            </div>
            <div>
              <p className="text-white font-semibold text-sm mb-1">{step.title}</p>
              <p className="text-gray-500 text-xs leading-relaxed">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="card-static p-5 space-y-3">
        <div className="flex items-center gap-2">
          <BookOpenIcon className="w-4 h-4 text-secondary" />
          <span className="text-sm font-semibold text-white">Server endpoint</span>
        </div>
        <div className="font-mono text-sm bg-surface-elevated border border-white/5 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BotIcon className="w-4 h-4 text-primary" />
            <span className="text-gray-300">{MCP_ENDPOINT}</span>
          </div>
          <CopyButton text={MCP_ENDPOINT} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center border-b border-white/5 overflow-x-auto">
          {(Object.keys(CLIENT_CONFIGS) as Client[]).map((key) => (
            <button
              key={key}
              onClick={() => setClient(key)}
              className={`px-4 sm:px-5 py-3 text-sm font-medium whitespace-nowrap transition-all ${
                client === key
                  ? 'text-primary bg-primary/10 border-b-2 border-primary'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-surface-elevated border border-white/5 text-[10px] flex items-center justify-center font-mono text-gray-300">
                  {CLIENT_CONFIGS[key].badge}
                </span>
                {CLIENT_CONFIGS[key].label}
              </span>
            </button>
          ))}
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          <CodeBlock
            title={current.filename}
            code={current.config}
            language="json"
            wrapLongLines
          />

          <p className="text-xs text-gray-500">{current.hint}</p>
        </div>
      </div>

      <div className="card p-5 sm:p-6 space-y-4" id="tools">
        <h2 className="text-xl sm:text-2xl font-bold text-white">Available MCP tools</h2>
        <p className="text-sm text-gray-400">
          These tools are read-oriented plus transaction building and live account fetching. Signing and broadcasting stay on your client side.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TOOLS.map(({ icon: Icon, name, desc }) => (
            <div key={name} className="bg-surface-elevated border border-white/5 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <Icon className="w-4 h-4 text-primary" />
                <span className="text-sm font-mono text-primary">{name}</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <SparklesIcon className="w-4 h-4 text-secondary" />
          <h2 className="text-lg sm:text-xl font-bold text-white">Try this prompt</h2>
        </div>
        <p className="text-sm text-gray-400">
          Once the server is connected, paste either of these into your assistant.
          The full pipeline (research → resolve → build → simulate → sign) runs inside one prompt.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="bg-surface-elevated border border-white/5 rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-mono mb-2">single tool call</p>
            <p className="text-sm text-gray-200 leading-relaxed">
              "Use orquestra to list every instruction on the Marinade program."
            </p>
          </div>
          <div className="bg-surface-elevated border border-secondary/20 rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wider text-secondary font-mono mb-2">full conductor pipeline</p>
            <p className="text-sm text-gray-200 leading-relaxed">
              "Stake 1 SOL with Marinade. Simulate first, then ask me before signing."
            </p>
          </div>
        </div>
      </div>

      <div className="card-static p-5 border border-yellow-500/20 bg-yellow-500/5">
        <p className="text-sm text-gray-300 leading-relaxed">
          <span className="text-yellow-300 font-semibold">Note:</span> MCP only exposes projects marked as public.
          Private projects remain inaccessible even if project IDs are known.
        </p>
      </div>

      {/* Scope Keys */}
      <div className="card p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2">
          <KeyIcon className="w-4 h-4 text-primary" />
          <h2 className="text-lg sm:text-xl font-bold text-white">Scope Keys</h2>
        </div>
        <p className="text-sm text-gray-400 leading-relaxed">
          Scope Keys let you restrict <code className="bg-white/10 px-1 rounded text-xs">search_programs</code>{' '}
          to a curated collection of programs you've saved in{' '}
          <a href="/lists" className="text-primary hover:underline">My Lists</a>.
          Without a scope key every public program is searchable — a scope key narrows results to only the programs
          in that list.
        </p>

        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-300">How to use a scope key:</p>
          <ol className="text-sm text-gray-400 space-y-2 list-decimal list-inside">
            <li>
              Go to <a href="/lists" className="text-primary hover:underline">My Lists</a>, create a list, and
              add the programs you want to include.
            </li>
            <li>Copy the scope key (<code className="bg-white/10 px-1 rounded text-xs">sk_…</code>) shown on the list.</li>
            <li>Add it to your MCP client config as shown below.</li>
          </ol>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-300">Config examples with scope key:</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs text-gray-500 font-mono mb-1.5">Claude Code / Cursor</p>
              <CodeBlock
                code={JSON.stringify({
                  mcpServers: {
                    orquestra: {
                      type: 'http',
                      url: MCP_ENDPOINT,
                      headers: { 'X-Scope-Key': 'sk_your_scope_key_here' },
                    },
                  },
                }, null, 2)}
                language="json"
              />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-mono mb-1.5">Claude Desktop (via wrapper)</p>
              <CodeBlock
                code={JSON.stringify({
                  mcpServers: {
                    orquestra: {
                      command: 'npx',
                      args: [
                        '-y',
                        '@modelcontextprotocol/client-streamable-http',
                        '--header',
                        'X-Scope-Key: sk_your_scope_key_here',
                        MCP_ENDPOINT,
                      ],
                    },
                  },
                }, null, 2)}
                language="json"
              />
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-500">
          You can regenerate a scope key at any time from My Lists — the old key stops working immediately.
          Regeneration does not affect the programs in the list.
        </p>
      </div>
    </div>
  )
}
