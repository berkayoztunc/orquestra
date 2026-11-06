import { useEffect, useState } from 'react'
import { Bot, Check } from 'lucide-react'
import CodeBlock from './CodeBlock'
import { Card } from '@/ui/Card'

type ClientId = 'claude-code' | 'cursor' | 'desktop' | 'vscode' | 'grok'

const MCP_URL = 'https://api.orquestra.dev/mcp'

const clients: Record<ClientId, { label: string; hint: string; language: 'bash' | 'json'; code: string }> = {
  'claude-code': {
    label: 'Claude Code',
    hint: 'one command',
    language: 'bash',
    code: `claude mcp add --transport http orquestra ${MCP_URL}`,
  },
  cursor: {
    label: 'Cursor',
    hint: '.cursor/mcp.json',
    language: 'json',
    code: `{
  "mcpServers": {
    "orquestra": { "url": "${MCP_URL}" }
  }
}`,
  },
  desktop: {
    label: 'Claude Desktop',
    hint: 'claude_desktop_config.json',
    language: 'json',
    code: `{
  "mcpServers": {
    "orquestra": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/client-streamable-http", "${MCP_URL}"]
    }
  }
}`,
  },
  grok: {
    label: 'Grok',
    hint: 'xAI API · Responses · remote MCP tool',
    language: 'bash',
    code: `curl https://api.x.ai/v1/responses \\
  -H "Authorization: Bearer $XAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "grok-4.3",
    "input": "Find the Jupiter program and list its instructions",
    "tools": [{
      "type": "mcp",
      "server_url": "${MCP_URL}",
      "server_label": "orquestra"
    }]
  }'`,
  },
  vscode: {
    label: 'VS Code',
    hint: '.vscode/mcp.json',
    language: 'json',
    code: `{
  "servers": {
    "orquestra": { "type": "http", "url": "${MCP_URL}" }
  }
}`,
  },
}

const steps = [
  { tool: 'search_programs', note: 'finds the Jupiter program' },
  { tool: 'list_instructions', note: 'reads accounts and args from the IDL' },
  { tool: 'derive_pda', note: 'resolves the missing accounts' },
  { tool: 'build_instruction', note: 'returns an unsigned transaction' },
  { tool: 'simulate_instruction', note: 'preflight: success, 41k CU' },
]

export default function AgentSetupCard(): JSX.Element {
  const [client, setClient] = useState<ClientId>('claude-code')
  const [active, setActive] = useState(0)
  const current = clients[client]

  // Walk through the tool calls so the transcript feels alive; skipped for reduced-motion users.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setActive(steps.length - 1)
      return
    }
    const timer = setInterval(() => setActive((i) => (i + 1) % steps.length), 1400)
    return () => clearInterval(timer)
  }, [])

  return (
    <Card className="min-w-0 overflow-hidden p-5 md:p-6" tone="sand">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">AI agent setup</p>
          <h2 className="mt-2 text-xl font-semibold text-sand-1600">Give your agent real Solana tools.</h2>
          <p className="mt-2 text-sm leading-6 text-sand-1200">
            Connect once, then ask in plain English. Your agent discovers, builds and simulates; you sign.
          </p>
        </div>
        <Bot className="size-5 flex-shrink-0 text-sand-1100" aria-hidden="true" />
      </div>

      {/* Step 1: connect */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">
          <span className="flex size-5 items-center justify-center bg-sand-1600 text-[10px] text-sand-50">1</span>
          Connect
        </p>
        <div role="tablist" aria-label="MCP client" className="inline-flex flex-wrap border border-border-low">
          {(Object.keys(clients) as ClientId[]).map((id) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={client === id}
              onClick={() => setClient(id)}
              className={`px-2.5 py-1 font-mono text-[11px] transition-colors ${
                client === id ? 'bg-sand-1600 text-sand-50' : 'bg-sand-50 text-sand-1200 hover:text-sand-1600'
              }`}
            >
              {clients[id].label}
            </button>
          ))}
        </div>
      </div>
      <CodeBlock language={current.language} code={current.code} copyable={false} wrapLongLines maxHeightClassName="max-h-[200px]" />
      <p className="mt-1.5 font-mono text-[11px] text-sand-1100">{current.hint}</p>

      {/* Step 2: ask */}
      <p className="mb-2 mt-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">
        <span className="flex size-5 items-center justify-center bg-sand-1600 text-[10px] text-sand-50">2</span>
        Ask
      </p>
      <div className="border border-border-low bg-sand-50 p-4">
        <p className="ml-auto w-fit max-w-[92%] bg-sand-1600 px-3 py-2 text-sm text-sand-50">
          Swap 1 SOL for USDC on Jupiter. Simulate first, then ask me before signing.
        </p>
        <ol className="mt-3 space-y-1.5" aria-label="Tool calls the agent makes">
          {steps.map((s, i) => {
            const done = i <= active
            return (
              <li
                key={s.tool}
                className={`flex items-center gap-2.5 border px-2.5 py-1.5 transition-all duration-300 ${
                  i === active ? 'border-sand-1500 bg-sand-100' : 'border-border-low bg-bg1'
                } ${done ? 'opacity-100' : 'opacity-45'}`}
              >
                <span
                  className={`flex size-4 flex-shrink-0 items-center justify-center rounded-full border ${
                    done ? 'border-sand-1500 bg-sand-1500 text-sand-50' : 'border-border-medium text-transparent'
                  }`}
                  aria-hidden="true"
                >
                  <Check className="size-3" />
                </span>
                <code className="font-mono text-xs text-sand-1600">{s.tool}</code>
                <span className="hidden min-w-0 flex-1 truncate text-right text-xs text-sand-1100 sm:block">{s.note}</span>
              </li>
            )
          })}
        </ol>
        <p className="mt-3 text-xs leading-5 text-sand-1200">
          Signing never leaves your side: the agent hands back an unsigned transaction.
        </p>
      </div>
    </Card>
  )
}
