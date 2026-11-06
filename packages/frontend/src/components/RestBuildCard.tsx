import { useState } from 'react'
import { Terminal } from 'lucide-react'
import CodeBlock from './CodeBlock'
import { Card } from '@/ui/Card'

type Tab = 'curl' | 'typescript' | 'python'

const BASE = 'https://api.orquestra.dev'

const snippets: Record<Tab, { label: string; language: 'bash' | 'typescript' | 'python'; code: string }> = {
  curl: {
    label: 'curl',
    language: 'bash',
    code: `curl -X POST "${BASE}/api/{projectId}/instructions/deposit/build" \\
  -H "Content-Type: application/json" \\
  -d '{
    "accounts": { "state": "8szGk...", "user": "9xTy..." },
    "args": { "lamports": 1000000000 },
    "feePayer": "9xTy...",
    "network": "mainnet-beta",
    "txVersion": "v1"
  }'`,
  },
  typescript: {
    label: 'TypeScript',
    language: 'typescript',
    code: `const res = await fetch(
  "${BASE}/api/{projectId}/instructions/deposit/build",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accounts: { state: "8szGk...", user: "9xTy..." },
      args: { lamports: 1_000_000_000 },
      feePayer: "9xTy...",
      txVersion: "v1", // optional: legacy (default) | v0 | v1
    }),
  },
)
const { transaction, wireFormat } = await res.json()`,
  },
  python: {
    label: 'Python',
    language: 'python',
    code: `import requests

res = requests.post(
    "${BASE}/api/{projectId}/instructions/deposit/build",
    json={
        "accounts": {"state": "8szGk...", "user": "9xTy..."},
        "args": {"lamports": 1_000_000_000},
        "feePayer": "9xTy...",
        "txVersion": "v1",  # optional: legacy (default) | v0 | v1
    },
)
tx = res.json()["transaction"]`,
  },
}

const responseSample = `{
  "transaction": "AQAAAAAAAAAAAA...",
  "wireFormat": "v1",
  "encoding": "base64",
  "estimatedFee": 5000,
  "recentBlockhash": "7Zy3...",
  "riskLevel": "low"
}`

const formats = [
  { id: 'legacy', note: 'default' },
  { id: 'v0', note: 'opt-in' },
  { id: 'v1', note: 'opt-in' },
]

export default function RestBuildCard(): JSX.Element {
  const [tab, setTab] = useState<Tab>('curl')
  const active = snippets[tab]

  return (
    <Card className="min-w-0 overflow-hidden p-5 md:p-6" tone="sand">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">REST transaction build</p>
          <h2 className="mt-2 text-xl font-semibold text-sand-1600">One POST in. An unsigned transaction out.</h2>
          <p className="mt-2 text-sm leading-6 text-sand-1200">
            No SDK, no IDL parsing, no account encoding. Sign it with your own wallet or signer.
          </p>
        </div>
        <Terminal className="size-5 flex-shrink-0 text-sand-1100" aria-hidden="true" />
      </div>

      {/* Step 1: request */}
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">
          <span className="flex size-5 items-center justify-center bg-sand-1600 text-[10px] text-sand-50">1</span>
          Request
        </p>
        <div role="tablist" aria-label="Request language" className="inline-flex border border-border-low">
          {(Object.keys(snippets) as Tab[]).map((id) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`px-2.5 py-1 font-mono text-[11px] transition-colors ${
                tab === id ? 'bg-sand-1600 text-sand-50' : 'bg-sand-50 text-sand-1200 hover:text-sand-1600'
              }`}
            >
              {snippets[id].label}
            </button>
          ))}
        </div>
      </div>
      <CodeBlock language={active.language} code={active.code} copyable={false} wrapLongLines maxHeightClassName="max-h-[300px]" />

      {/* connector */}
      <div className="my-3 flex items-center gap-3 text-sand-1100" aria-hidden="true">
        <span className="h-px flex-1 bg-border-low" />
        <span className="font-mono text-[11px] uppercase tracking-[0.12em]">builds at the edge</span>
        <span className="h-px flex-1 bg-border-low" />
      </div>

      {/* Step 2: response */}
      <p className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">
        <span className="flex size-5 items-center justify-center bg-sand-1600 text-[10px] text-sand-50">2</span>
        Response
      </p>
      <CodeBlock language="json" code={responseSample} copyable={false} wrapLongLines />

      {/* format chips */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">txVersion</span>
        {formats.map((f) => (
          <span key={f.id} className="inline-flex items-center gap-1.5 border border-border-low bg-sand-50 px-2 py-1 font-mono text-[11px] text-sand-1500">
            {f.id}
            <span className="text-sand-1100">· {f.note}</span>
          </span>
        ))}
        <span className="font-mono text-[11px] text-sand-1100">+ simulate: true for preflight</span>
      </div>
    </Card>
  )
}
