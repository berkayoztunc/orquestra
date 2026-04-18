import { useState } from 'react'
import {
  CheckIcon,
  CopyIcon,
  BookOpenIcon,
  BotIcon,
  SearchIcon,
  ListIcon,
  ZapIcon,
  MapPinIcon,
  KeyIcon,
  FileTextIcon,
  SparklesIcon,
} from 'lucide-react'

type Client = 'claude' | 'cursor' | 'vscode'

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
          derive PDAs, and build unsigned transactions directly from prompts.
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-500 font-mono">{current.filename}</p>
            <CopyButton text={current.config} />
          </div>

          <pre className="text-xs sm:text-sm font-mono leading-relaxed bg-surface-elevated border border-white/5 rounded-xl p-4 overflow-x-auto text-gray-300">
            <code>{current.config}</code>
          </pre>

          <p className="text-xs text-gray-500">{current.hint}</p>
        </div>
      </div>

      <div className="card p-5 sm:p-6 space-y-4" id="tools">
        <h2 className="text-xl sm:text-2xl font-bold text-white">Available MCP tools</h2>
        <p className="text-sm text-gray-400">
          These tools are read-oriented plus transaction building only. Signing and broadcasting stay on your client side.
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

      <div className="card-static p-5 border border-yellow-500/20 bg-yellow-500/5">
        <p className="text-sm text-gray-300 leading-relaxed">
          <span className="text-yellow-300 font-semibold">Note:</span> MCP only exposes projects marked as public.
          Private projects remain inaccessible even if project IDs are known.
        </p>
      </div>
    </div>
  )
}
