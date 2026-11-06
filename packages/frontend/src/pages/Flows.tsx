import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, ChevronDown, ChevronRight, CircleDot, Copy, Loader2, Play, RotateCcw, Search, Sparkles, X } from 'lucide-react'
import { listFlows, runFlowEstimate, type FlowRunResponse, type FlowSummary } from '../api/client'
import CodeBlock from '../components/CodeBlock'
import { PageShell } from '@/ui/PageShell'
import { cn } from '@/ui/cn'

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Spec = { type: string; description?: string }
type TxFormat = 'v0' | 'legacy' | 'v1'

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const API_BASE = 'https://api.orquestra.dev'

/** Inputs verified against the live API, so "Load sample" always produces a real run. */
const SAMPLES: Record<string, Record<string, string>> = {
  'spl-token-transfer-checked': {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    sourceOwner: '8drh4w7p1Mfw4YAkDAswoRwuD1V9sPY1UM2o2xr8kAqu',
    destinationOwner: '8D8qFHBnvS6oMsJy7EmGTrpoZcGd3aCC3pnPLi93Ag2V',
    amount: '1000000',
    decimals: '6',
  },
  'letmebuy-purchase-and-deliver': {
    buyer: '8drh4w7p1Mfw4YAkDAswoRwuD1V9sPY1UM2o2xr8kAqu',
    storeName: 'jonasbar',
    productName: 'Water',
    tableNumber: '11',
  },
}

const isNumeric = (t: string): boolean => /^[ui]\d+$/.test(t)
const isFloat = (t: string): boolean => /^f\d+$/.test(t)
const short = (v: string, n = 4): string => (v.length > n * 2 + 1 ? `${v.slice(0, n)}…${v.slice(-n)}` : v)
const pretty = (s: string): string => s.replace(/_/g, ' ')

function validate(type: string, raw: string): string | null {
  const v = raw.trim()
  if (type === 'bool') return null
  if (!v) return 'Required'
  if (type === 'pubkey') return BASE58.test(v) ? null : 'Not a valid Solana address'
  if (isNumeric(type)) return /^\d+$/.test(v) || (type.startsWith('i') && /^-?\d+$/.test(v)) ? null : 'Whole number expected'
  if (isFloat(type)) return Number.isFinite(Number(v)) ? null : 'Number expected'
  return null
}

function coerce(type: string, raw: string): unknown {
  const v = raw.trim()
  if (type === 'bool') return v === 'true'
  if (isNumeric(type)) return Number.isSafeInteger(Number(v)) ? Number(v) : v
  if (isFloat(type)) return Number(v)
  return v
}

function buildInputs(spec: Record<string, Spec>, values: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(spec).map(([k, s]) => [k, coerce(s.type, values[k] ?? (s.type === 'bool' ? 'false' : ''))]))
}

function mcpSnippet(flow: FlowSummary, inputs: Record<string, unknown>, network: string): string {
  return `estimate_flow({\n  "slug": "${flow.slug}",\n  "inputs": ${JSON.stringify(inputs, null, 2).replace(/\n/g, '\n  ')},\n  "network": "${network}"\n})`
}

function curlSnippet(flow: FlowSummary, inputs: Record<string, unknown>, network: string, tx: TxFormat): string {
  const body = { inputs, network, ...(tx === 'v0' ? {} : { txVersion: tx }) }
  return `curl -X POST ${API_BASE}/flows/${flow.slug}/estimate \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body, null, 2)}'`
}

// ─── Execution trace ─────────────────────────────────────────────────────────

interface TraceStep {
  key: string
  kind: 'account' | 'address' | 'instruction' | 'transaction' | 'data'
  title: string
  summary: ReactNode
  raw: unknown
  tone?: 'ok' | 'warn' | 'bad'
}

function describe(key: string, value: unknown): TraceStep {
  const v = value as any
  if (v && Array.isArray(v.transactions)) {
    const tx = v.transactions[0] ?? {}
    return {
      key,
      kind: 'transaction',
      title: key,
      raw: value,
      tone: tx.simulation?.success === false ? 'bad' : 'ok',
      summary: (
        <>
          {v.transactions.length} transaction{v.transactions.length !== 1 ? 's' : ''} composed
          {tx.wireFormat ? ` · ${tx.wireFormat}` : ''}
          {tx.simulation ? (tx.simulation.success ? ` · simulation passed (${tx.simulation.computeUnits ?? '?'} CU)` : ' · simulation failed') : ''}
        </>
      ),
    }
  }
  if (v?.instruction?.programId) {
    return {
      key,
      kind: 'instruction',
      title: key,
      raw: value,
      tone: v.riskLevel === 'high' ? 'warn' : 'ok',
      summary: (
        <>
          Instruction for <code className="font-mono">{short(v.instruction.programId)}</code> · {v.instruction.keys?.length ?? 0} accounts
          {v.riskLevel ? ` · risk ${v.riskLevel}` : ''}
        </>
      ),
    }
  }
  if (v && typeof v.address === 'string') {
    return {
      key,
      kind: 'address',
      title: key,
      raw: value,
      summary: (
        <>
          Resolved <code className="font-mono">{short(v.address, 6)}</code>
          {typeof v.exists === 'boolean' ? (v.exists ? ' · exists on-chain' : ' · will be created') : ''}
          {typeof v.bump === 'number' ? ` · bump ${v.bump}` : ''}
        </>
      ),
    }
  }
  if (v && typeof v.exists === 'boolean' && v.accountType) {
    return { key, kind: 'account', title: key, raw: value, summary: <>Read {v.accountType} account from chain{v.exists ? '' : ' (not found)'}</> }
  }
  const json = JSON.stringify(value)
  return { key, kind: 'data', title: key, raw: value, summary: <span className="font-mono">{json.length > 90 ? `${json.slice(0, 90)}…` : json}</span> }
}

const KIND_LABEL: Record<TraceStep['kind'], string> = {
  address: 'resolve',
  account: 'read',
  instruction: 'build',
  transaction: 'compose',
  data: 'step',
}

function Trace({ outputs, failedNode }: { outputs: Record<string, unknown>; failedNode?: string | null }): JSX.Element {
  const steps = Object.entries(outputs).map(([k, v]) => describe(k, v))
  return (
    <ol className="relative space-y-3 border-l border-border-low pl-5">
      {steps.map((s, i) => (
        <li key={s.key} className="relative" style={{ animation: 'flowStep 260ms ease-out both', animationDelay: `${i * 70}ms` }}>
          <span
            className={cn(
              'absolute -left-[27px] top-0.5 flex size-3.5 items-center justify-center rounded-full border-2 bg-bg1',
              s.tone === 'bad' ? 'border-[#b71c00]' : s.tone === 'warn' ? 'border-[#b75000]' : 'border-sand-1600',
            )}
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="border border-border-low bg-sand-100 px-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-sand-1200">{KIND_LABEL[s.kind]}</span>
            <code className="font-mono text-sm font-semibold text-sand-1600">{s.title}</code>
          </div>
          <p className="mt-1 text-xs leading-5 text-sand-1200">{s.summary}</p>
          <details className="mt-1 group">
            <summary className="cursor-pointer select-none font-mono text-[11px] text-sand-1000 hover:text-sand-1600">raw output</summary>
            <pre className="mt-1 max-h-56 overflow-auto border border-border-low bg-sand-50 p-2 font-mono text-[11px] leading-5 text-sand-1400">
              {JSON.stringify(s.raw, null, 2)}
            </pre>
          </details>
        </li>
      ))}
      {failedNode && (
        <li className="relative">
          <span className="absolute -left-[27px] top-0.5 flex size-3.5 items-center justify-center rounded-full border-2 border-[#b71c00] bg-[#b71c00]" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="border border-[#b71c00]/30 bg-[#b71c00]/10 px-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#b71c00]">failed</span>
            <code className="font-mono text-sm font-semibold text-sand-1600">{failedNode}</code>
          </div>
        </li>
      )}
    </ol>
  )
}

// ─── Studio ──────────────────────────────────────────────────────────────────

function useCopy(): [string | null, (id: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(id)
        setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500)
      },
      () => undefined,
    )
  }
  return [copied, copy]
}

function Field({ name, spec, value, error, onChange }: { name: string; spec: Spec; value: string; error?: string; onChange: (v: string) => void }): JSX.Element {
  const id = `field-${name}`
  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-sand-1600">{name}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-sand-1000">{spec.type}</span>
      </label>
      {spec.type === 'bool' ? (
        <div role="radiogroup" aria-label={name} className="inline-flex h-10 border border-border-medium">
          {['false', 'true'].map((opt) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={(value || 'false') === opt}
              onClick={() => onChange(opt)}
              className={cn(
                'min-w-16 px-4 font-mono text-xs transition-colors',
                (value || 'false') === opt ? 'bg-sand-1600 text-bg1' : 'bg-bg1 text-sand-1200 hover:bg-sand-100',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={isNumeric(spec.type) || isFloat(spec.type) ? 'numeric' : 'text'}
          autoComplete="off"
          spellCheck={false}
          placeholder={spec.type === 'pubkey' ? 'Solana address' : isNumeric(spec.type) ? '0' : ''}
          aria-invalid={error ? 'true' : undefined}
          className={cn('input h-10 w-full', spec.type === 'pubkey' && 'font-mono text-xs', error && 'border-red-500/60')}
        />
      )}
      {error ? <p className="mt-1 text-[11px] text-red-500">{error}</p> : spec.description ? <p className="mt-1 text-[11px] leading-4 text-sand-1000">{spec.description}</p> : null}
    </div>
  )
}

function Studio({ flow }: { flow: FlowSummary }): JSX.Element {
  const inputs = flow.inputs as Record<string, Spec>
  const entries = Object.entries(inputs)
  const networks = flow.meta.networks?.length ? flow.meta.networks : ['mainnet-beta']
  const sample = SAMPLES[flow.slug]

  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [network, setNetwork] = useState(networks[0])
  const [txFormat, setTxFormat] = useState<TxFormat>('v0')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ data: FlowRunResponse; ms: number } | null>(null)
  const [tab, setTab] = useState<'mcp' | 'rest' | 'contract'>('mcp')
  const [copied, copy] = useCopy()

  // A different flow starts from a clean slate.
  useEffect(() => {
    setValues({})
    setErrors({})
    setResult(null)
    setNetwork(networks[0])
    setTxFormat('v0')
    setTab('mcp')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.slug])

  const liveInputs = useMemo(() => buildInputs(inputs, values), [inputs, values])

  async function run() {
    const next: Record<string, string> = {}
    for (const [name, spec] of entries) {
      const err = validate(spec.type, values[name] ?? '')
      if (err) next[name] = err
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setRunning(true)
    setResult(null)
    try {
      const r = await runFlowEstimate(flow.slug, { inputs: liveInputs, network, ...(txFormat === 'v0' ? {} : { txVersion: txFormat }) })
      setResult({ data: r.data, ms: r.ms })
    } catch (e: any) {
      setResult({ data: { ok: false, reason: e?.message ?? 'Network error — could not reach the API.' }, ms: 0 })
    } finally {
      setRunning(false)
    }
  }

  const finalTx = useMemo(() => {
    if (!result?.data.ok || !result.data.outputs) return null
    for (const v of Object.values(result.data.outputs)) {
      const t = (v as any)?.transactions?.[0]
      if (t?.unsignedTransaction) return { tx: t as { unsignedTransaction: string; wireFormat?: string; simulation?: { success: boolean; computeUnits?: number } }, all: (v as any).transactions as unknown[] }
    }
    return null
  }, [result])

  return (
    <div className="min-w-0 space-y-6">
      {/* Header */}
      <header>
        <div className="flex flex-wrap items-center gap-2">
          {flow.protocol && <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1000">{flow.protocol}</span>}
          <span className="border border-sand-1600 bg-sand-1600 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-bg1">{pretty(flow.intent)}</span>
          {networks.map((n) => (
            <span key={n} className="border border-border-low bg-sand-100 px-2 py-0.5 font-mono text-[11px] text-sand-1300">
              {n}
            </span>
          ))}
        </div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-sand-1600">{flow.meta.name}</h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-sand-1200">{flow.meta.description || 'No description provided for this flow.'}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] text-sand-1100">
          <button type="button" onClick={() => copy('slug', flow.slug)} className="inline-flex items-center gap-1.5 hover:text-sand-1600">
            {copied === 'slug' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {flow.slug}
          </button>
          {(flow.meta.programs ?? []).map((id) => (
            <Link key={id} to={`/project/${id}`} className="inline-flex items-center gap-1 underline-offset-4 hover:text-sand-1600 hover:underline" title={id}>
              program {short(id)} <ArrowRight className="size-3" />
            </Link>
          ))}
        </div>
      </header>

      {/* How it works */}
      <div className="grid items-stretch gap-2 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]" aria-label="How this flow works">
        <div className="border border-border-low bg-bg1 p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-sand-1000">You provide</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {entries.slice(0, 6).map(([n]) => (
              <span key={n} className="border border-border-low bg-sand-50 px-1.5 py-0.5 font-mono text-[10px] text-sand-1400">
                {n}
              </span>
            ))}
            {entries.length > 6 && <span className="font-mono text-[10px] text-sand-1000">+{entries.length - 6}</span>}
          </div>
        </div>
        <ChevronRight className="mx-auto hidden size-4 self-center text-sand-1000 md:block" aria-hidden="true" />
        <div className="border border-sand-1600 bg-sand-1600 p-3 text-bg1">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] opacity-70">Flow Engine</p>
          <p className="mt-2 text-xs leading-5">Resolves PDAs and token accounts, reads on-chain state, builds the instruction, then simulates the transaction.</p>
        </div>
        <ChevronRight className="mx-auto hidden size-4 self-center text-sand-1000 md:block" aria-hidden="true" />
        <div className="border border-border-low bg-bg1 p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-sand-1000">You get</p>
          <p className="mt-2 text-xs leading-5 text-sand-1300">
            {Object.entries(flow.outputs)
              .map(([n, s]) => `${n} (${(s as Spec).type})`)
              .join(', ') || 'Unsigned transactions'}
            . Sign it with your own wallet.
          </p>
        </div>
      </div>

      {/* Run it */}
      <section className="border border-border-low bg-bg1" aria-label="Run this flow">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-low px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-sand-1600">
            <Sparkles className="size-4" aria-hidden="true" />
            Try it live
          </h3>
          <div className="flex items-center gap-2">
            {sample && (
              <button
                type="button"
                onClick={() => {
                  setValues(sample)
                  setErrors({})
                }}
                className="inline-flex h-8 items-center gap-1.5 border border-border-medium bg-bg1 px-3 text-xs font-medium text-sand-1500 transition-colors hover:bg-sand-100"
              >
                Load sample
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setValues({})
                setErrors({})
                setResult(null)
              }}
              className="inline-flex h-8 items-center gap-1.5 px-2 text-xs text-sand-1100 transition-colors hover:text-sand-1600"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Reset
            </button>
          </div>
        </div>

        <form
          className="space-y-5 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            void run()
          }}
        >
          {entries.length === 0 ? (
            <p className="text-sm text-sand-1200">This flow needs no inputs.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {entries.map(([name, spec]) => (
                <Field
                  key={name}
                  name={name}
                  spec={spec}
                  value={values[name] ?? ''}
                  error={errors[name]}
                  onChange={(v) => {
                    setValues((prev) => ({ ...prev, [name]: v }))
                    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }))
                  }}
                />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-border-low pt-4">
            {networks.length > 1 ? (
              <select value={network} onChange={(e) => setNetwork(e.target.value)} aria-label="Network" className="input h-10 w-44">
                {networks.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            ) : null}
            <div role="radiogroup" aria-label="Transaction format" className="inline-flex h-10 border border-border-medium">
              {(['v0', 'legacy', 'v1'] as TxFormat[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={txFormat === f}
                  onClick={() => setTxFormat(f)}
                  className={cn('px-3 font-mono text-xs transition-colors', txFormat === f ? 'bg-sand-1600 text-bg1' : 'bg-bg1 text-sand-1200 hover:bg-sand-100')}
                >
                  {f}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={running}
              className="ml-auto inline-flex h-10 items-center gap-2 border border-sand-1600 bg-sand-1600 px-5 text-sm font-medium text-bg1 transition-colors hover:bg-sand-1400 disabled:cursor-wait disabled:opacity-60"
            >
              {running ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
              {running ? 'Running…' : 'Run flow'}
            </button>
          </div>
        </form>

        {/* Result */}
        {(running || result) && (
          <div className="space-y-4 border-t border-border-low bg-sand-50 p-4" aria-live="polite">
            {running && !result && (
              <p className="flex items-center gap-2 text-sm text-sand-1200">
                <CircleDot className="size-4 animate-pulse" aria-hidden="true" />
                Resolving accounts, building and simulating on {network}…
              </p>
            )}

            {result && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p
                    className={cn(
                      'inline-flex items-center gap-2 border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]',
                      result.data.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-[#b71c00]/30 bg-[#b71c00]/10 text-[#b71c00]',
                    )}
                  >
                    {result.data.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                    {result.data.ok ? 'Flow completed' : 'Flow failed'}
                  </p>
                  {result.ms > 0 && <span className="font-mono text-[11px] text-sand-1000">{result.ms} ms</span>}
                </div>

                {!result.data.ok && (
                  <div role="alert" className="border border-[#b71c00]/25 bg-[#b71c00]/5 p-3 text-sm text-sand-1500">
                    <p className="font-semibold">{result.data.kind === 'run_error' ? 'A step failed' : 'The flow could not run'}</p>
                    <p className="mt-1 break-words text-xs leading-5 text-sand-1300">{result.data.reason}</p>
                    {result.data.nodeId && <p className="mt-1 font-mono text-[11px] text-sand-1100">at step “{result.data.nodeId}” — check the inputs it uses.</p>}
                  </div>
                )}

                <Trace outputs={(result.data.ok ? result.data.outputs : result.data.partialOutputs) ?? {}} failedNode={result.data.ok ? null : result.data.nodeId} />

                {finalTx && (
                  <div className="border border-sand-1600 bg-bg1 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-sand-1600">Unsigned transaction ready</p>
                      <button
                        type="button"
                        onClick={() => copy('tx', finalTx.tx.unsignedTransaction)}
                        className="inline-flex h-8 items-center gap-1.5 border border-border-medium bg-bg1 px-3 text-xs font-medium text-sand-1500 hover:bg-sand-100"
                      >
                        {copied === 'tx' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        {copied === 'tx' ? 'Copied' : 'Copy base64'}
                      </button>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-sand-1100">
                      {finalTx.tx.wireFormat ?? 'v0'} · {Math.round((finalTx.tx.unsignedTransaction.length * 3) / 4)} bytes
                      {finalTx.tx.simulation ? ` · simulation ${finalTx.tx.simulation.success ? 'passed' : 'failed'}` : ''} · nothing was signed or sent
                    </p>
                    <p className="mt-2 break-all font-mono text-[11px] leading-5 text-sand-1300">{short(finalTx.tx.unsignedTransaction, 44)}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* Use it elsewhere */}
      <section aria-label="Use this flow from your own code">
        <div role="tablist" aria-label="Integration" className="mb-3 inline-flex h-9 border border-border-low">
          {(
            [
              ['mcp', 'MCP'],
              ['rest', 'REST'],
              ['contract', 'Contract'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn('px-4 text-xs font-medium transition-colors', tab === id ? 'bg-sand-1600 text-bg1' : 'bg-bg1 text-sand-1200 hover:text-sand-1600')}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'mcp' && (
          <CodeBlock language="typescript" code={mcpSnippet(flow, liveInputs, network)} copyable wrapLongLines title="Flow Engine MCP — estimate_flow" />
        )}
        {tab === 'rest' && <CodeBlock language="bash" code={curlSnippet(flow, liveInputs, network, txFormat)} copyable wrapLongLines title="REST" />}
        {tab === 'contract' && (
          <CodeBlock language="json" code={JSON.stringify({ inputs: flow.inputs, outputs: flow.outputs }, null, 2)} copyable wrapLongLines title="Published contract" />
        )}
        <p className="mt-2 text-xs text-sand-1100">
          The snippets use the values from the form above.{' '}
          <Link to="/docs/flow-engine" className="underline underline-offset-4 hover:text-sand-1600">
            How flows work →
          </Link>
        </p>
      </section>
    </div>
  )
}

// ─── Flow Engine illustration ────────────────────────────────────────────────

// Real numbers, read from the PumpFun IDL: `buy_v2` takes 27 accounts + 2 args, and the published `pumpfun-buy` flow asks for 4 inputs.
// The account groups below are that instruction's real breakdown (14 PDAs, 6 programs, 2 mints, 1 signer, 4 token/fee accounts).
const RAW_ACCOUNTS = 27
const RAW_ARGS = 2
const ACCOUNT_GROUPS = [
  { key: 'pda', label: 'derived PDAs', count: 14, hint: 'seeds must be exact' },
  { key: 'program', label: 'programs', count: 6, hint: '' },
  { key: 'token', label: 'token & fee', count: 4, hint: '' },
  { key: 'mint', label: 'mints', count: 2, hint: '' },
  { key: 'signer', label: 'signer', count: 1, hint: 'you' },
] as const
const ENGINE_STEPS = ['derive 14 PDAs', 'resolve ATAs', 'read chain state', 'build + simulate'] as const
const FLOW_INPUTS = [
  ['buyer', 'pubkey'],
  ['mint', 'pubkey'],
  ['spendableQuoteIn', 'u64'],
  ['minTokensOut', 'u64'],
] as const

function CollapseDiagram(): JSX.Element {
  const ink = 'rgb(var(--rgb-sand-1600))'
  const line = 'rgb(var(--rgb-sand-800))'
  const edge = 'rgb(var(--rgb-border-medium))'
  const soft = 'rgb(var(--rgb-border-low))'
  const muted = 'rgb(var(--rgb-sand-1100))'
  const paper = 'rgb(var(--rgb-sand-50))'
  const card = 'rgb(var(--rgb-sand-100))'
  const accent = '#b75000'
  const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'

  const SQ = 11
  const GAP = 3
  const ROW0 = 112
  const ROW_PITCH = 30
  const LEFT = 176
  const ENGINE = { x: 440, y: 92, w: 176, h: 184 }
  const entryY = ENGINE.y + ENGINE.h / 2

  // Flat list of the 27 squares with the geometry of each, so the flying copies line up with the static ones.
  let n = 0
  const squares = ACCOUNT_GROUPS.flatMap((g, gi) =>
    Array.from({ length: g.count }, (_, k) => ({
      id: n++,
      group: g.key,
      x: LEFT + k * (SQ + GAP),
      y: ROW0 + gi * ROW_PITCH,
    })),
  )
  const fill = (group: string): { fill: string; stroke: string; opacity: number } =>
    group === 'pda'
      ? { fill: ink, stroke: ink, opacity: 1 }
      : group === 'program'
        ? { fill: ink, stroke: ink, opacity: 0.55 }
        : group === 'token'
          ? { fill: ink, stroke: ink, opacity: 0.3 }
          : group === 'mint'
            ? { fill: paper, stroke: ink, opacity: 1 }
            : { fill: accent, stroke: accent, opacity: 1 }

  return (
    <svg
      viewBox="0 0 880 330"
      className="h-auto w-full"
      role="img"
      aria-label={`Without the Flow Engine a PumpFun buy needs ${RAW_ACCOUNTS} accounts and ${RAW_ARGS} arguments, ${ACCOUNT_GROUPS[0].count} of them PDAs you must derive. With it you provide ${FLOW_INPUTS.length} inputs.`}
    >
      <defs>
        <pattern id="fc-dots" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill={soft} />
        </pattern>
        <marker id="fc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 .5L7.5 4L0 7.5z" fill={line} />
        </marker>
      </defs>
      <rect width="880" height="330" fill="url(#fc-dots)" opacity=".7" />

      {/* LEFT: the raw instruction, broken down by what each account is */}
      <text x="28" y="38" fontSize="11" fontFamily={mono} fill={muted} letterSpacing=".6">WITHOUT A FLOW</text>
      <text x="28" y="62" fontSize="20" fontFamily={mono} fontWeight="700" fill={ink}>{RAW_ACCOUNTS} accounts + {RAW_ARGS} args</text>
      <text x="28" y="82" fontSize="11" fontFamily={mono} fill={muted}>PumpFun buy_v2, each one found and ordered by hand</text>

      {ACCOUNT_GROUPS.map((g, gi) => (
        <g key={g.key}>
          <text x="28" y={ROW0 + gi * ROW_PITCH + 10} fontSize="10.5" fontFamily={mono} fill={muted}>
            {g.count} {g.label}
          </text>
        </g>
      ))}
      {squares.map((q) => {
        const f = fill(q.group)
        return <rect key={`g${q.id}`} x={q.x} y={q.y} width={SQ} height={SQ} rx="3" fill={f.fill} stroke={f.stroke} opacity={f.opacity * 0.22} />
      })}
      {[0, 1].map((i) => (
        <g key={`arg${i}`}>
          <rect x={28 + i * 78} y={ROW0 + 5 * ROW_PITCH} width="70" height="22" rx="11" fill={card} stroke={edge} />
          <text x={28 + i * 78 + 35} y={ROW0 + 5 * ROW_PITCH + 15} textAnchor="middle" fontSize="10" fontFamily={mono} fill={muted}>
            {i === 0 ? 'amount' : 'max_cost'}
          </text>
        </g>
      ))}

      {/* flying copies: every account is pulled into the engine */}
      {squares.map((q) => {
        const f = fill(q.group)
        return (
          <rect
            key={`f${q.id}`}
            className="fc-fly"
            x={q.x}
            y={q.y}
            width={SQ}
            height={SQ}
            rx="3"
            fill={f.fill}
            stroke={f.stroke}
            style={{ ['--dx' as string]: `${ENGINE.x - q.x - SQ / 2}px`, ['--dy' as string]: `${entryY - q.y - SQ / 2}px`, ['--i' as string]: q.id, opacity: f.opacity }}
          />
        )
      })}

      <path d={`M392 ${entryY}H${ENGINE.x - 8}`} stroke={line} strokeWidth="1.5" strokeDasharray="4 5" markerEnd="url(#fc-arrow)" />

      {/* MIDDLE: the engine and what it does for you */}
      <rect x={ENGINE.x} y={ENGINE.y} width={ENGINE.w} height={ENGINE.h} rx="14" fill={ink} />
      <text x={ENGINE.x + ENGINE.w / 2} y={ENGINE.y + 28} textAnchor="middle" fontSize="14" fontFamily={mono} fontWeight="700" fill={paper}>Flow Engine</text>
      <path d={`M${ENGINE.x + 18} ${ENGINE.y + 40}H${ENGINE.x + ENGINE.w - 18}`} stroke={paper} opacity=".25" />
      {ENGINE_STEPS.map((step, i) => (
        <g key={step} className="fc-step" style={{ ['--i' as string]: i }}>
          <rect x={ENGINE.x + 14} y={ENGINE.y + 54 + i * 30} width={ENGINE.w - 28} height="22" rx="11" fill={paper} opacity=".12" />
          <circle cx={ENGINE.x + 28} cy={ENGINE.y + 65 + i * 30} r="4.5" fill="none" stroke={paper} strokeWidth="1.4" />
          <path d={`M${ENGINE.x + 25.8} ${ENGINE.y + 65 + i * 30}l1.6 1.7 3-3.4`} fill="none" stroke={paper} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <text x={ENGINE.x + 40} y={ENGINE.y + 69 + i * 30} fontSize="10.5" fontFamily={mono} fill={paper}>{step}</text>
        </g>
      ))}

      <path d={`M${ENGINE.x + ENGINE.w + 8} ${entryY}H664`} stroke={line} strokeWidth="1.5" markerEnd="url(#fc-arrow)" />

      {/* RIGHT: what you provide, and what comes back */}
      <text x="672" y="38" fontSize="11" fontFamily={mono} fill={muted} letterSpacing=".6">WITH A FLOW</text>
      <text x="672" y="62" fontSize="20" fontFamily={mono} fontWeight="700" fill={ink}>{FLOW_INPUTS.length} inputs</text>
      <text x="672" y="82" fontSize="11" fontFamily={mono} fill={muted}>pumpfun-buy</text>
      {FLOW_INPUTS.map(([name, type], i) => (
        <g key={name} className="fc-input" style={{ ['--i' as string]: i }}>
          <rect x="672" y={98 + i * 32} width="184" height="26" rx="13" fill={paper} stroke={line} />
          <circle cx="688" cy={111 + i * 32} r="3.5" fill={ink} />
          <text x="700" y={115 + i * 32} fontSize="10.5" fontFamily={mono} fill={ink} fontWeight="600">{name}</text>
          <text x="844" y={115 + i * 32} textAnchor="end" fontSize="9.5" fontFamily={mono} fill={muted}>{type}</text>
        </g>
      ))}
      <g className="fc-out">
        <rect x="672" y="246" width="184" height="32" rx="16" fill={ink} />
        <circle cx="690" cy="262" r="6" fill="none" stroke={paper} strokeWidth="1.5" />
        <path d="M687.2 262l2.1 2.2 3.8-4.4" fill="none" stroke={paper} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <text x="704" y="266" fontSize="11" fontFamily={mono} fontWeight="700" fill={paper}>unsigned tx</text>
        <text x="844" y="266" textAnchor="end" fontSize="9.5" fontFamily={mono} fill={paper} opacity=".7">simulated</text>
      </g>
    </svg>
  )
}

/** One-line version of the same story, shown once a flow is open. */
function CollapseBar(): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-border-low bg-bg1 px-4 py-2.5 font-mono text-xs text-sand-1300">
      <span className="text-sand-1100 line-through decoration-sand-700">{RAW_ACCOUNTS} accounts + {RAW_ARGS} args</span>
      <ChevronRight className="size-3.5 text-sand-1000" aria-hidden="true" />
      <span className="bg-sand-1600 px-2 py-0.5 text-bg1">Flow Engine</span>
      <ChevronRight className="size-3.5 text-sand-1000" aria-hidden="true" />
      <span className="font-semibold text-sand-1600">{FLOW_INPUTS.length} inputs</span>
      <span className="ml-auto hidden text-[11px] text-sand-1000 sm:inline">PumpFun buy, for example</span>
    </div>
  )
}

// ─── Protocol picker (searchable select) ─────────────────────────────────────

function ProtocolSelect({ options, value, onChange, total }: { options: Array<[string, number]>; value: string; onChange: (v: string) => void; total: number }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = options.filter(([name]) => !q || name.toLowerCase().includes(q))
    return [['', total] as [string, number], ...list].filter(([name]) => name !== '' || !q)
  }, [options, query, total])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => setActive(0), [query, open])

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="input flex h-10 w-full items-center justify-between gap-2 text-left"
      >
        <span className={cn('truncate text-sm', !value && 'text-sand-1100')}>{value || `All protocols (${options.length})`}</span>
        <span className="flex shrink-0 items-center gap-1">
          {value && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear protocol filter"
              onClick={(e) => {
                e.stopPropagation()
                onChange('')
              }}
              className="flex size-5 items-center justify-center text-sand-1100 hover:text-sand-1600"
            >
              <X className="size-3.5" />
            </span>
          )}
          <ChevronDown className={cn('size-4 text-sand-1100 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 border border-border-medium bg-bg1 shadow-lg">
          <div className="relative border-b border-border-low">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sand-1000" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActive((a) => Math.min(a + 1, items.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((a) => Math.max(a - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  if (items[active]) pick(items[active][0])
                } else if (e.key === 'Escape') {
                  setOpen(false)
                }
              }}
              placeholder="Search protocols…"
              aria-label="Search protocols"
              role="combobox"
              aria-expanded="true"
              aria-controls="protocol-listbox"
              className="h-10 w-full bg-transparent pl-9 pr-3 text-sm text-sand-1600 outline-none placeholder:text-sand-1000"
            />
          </div>
          <ul id="protocol-listbox" role="listbox" className="max-h-64 overflow-y-auto py-1">
            {items.map(([name, count], i) => {
              const selected = value === name
              return (
                <li key={name || '__all'} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(name)}
                    className={cn('flex h-9 w-full items-center justify-between gap-3 px-3 text-left text-sm', i === active ? 'bg-sand-100' : '', selected ? 'font-semibold text-sand-1600' : 'text-sand-1300')}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Check className={cn('size-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                      <span className="truncate">{name || 'All protocols'}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-sand-1000">{count}</span>
                  </button>
                </li>
              )
            })}
            {items.length === 0 && <li className="px-3 py-3 text-sm text-sand-1100">No protocol matches “{query}”.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

export default function Flows(): JSX.Element {
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [protocol, setProtocol] = useState('')
  const selectedSlug = params.get('flow')

  useEffect(() => {
    let cancelled = false
    listFlows()
      .then((r) => !cancelled && setFlows(r))
      .catch(() => !cancelled && setError('Could not load the flow catalog. Try again shortly.'))
      .finally(() => !cancelled && setIsLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const protocols = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of flows) m.set(f.protocol ?? 'Other', (m.get(f.protocol ?? 'Other') ?? 0) + 1)
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [flows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return flows.filter((f) => {
      if (protocol && (f.protocol ?? 'Other') !== protocol) return false
      if (!q) return true
      return [f.slug, f.meta.name, f.meta.description, f.intent, f.protocol, ...(f.meta.programs ?? [])].filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [flows, search, protocol])

  const groups = useMemo(() => {
    const m = new Map<string, FlowSummary[]>()
    for (const f of filtered) {
      const k = f.protocol ?? 'Other'
      m.set(k, [...(m.get(k) ?? []), f])
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  // Nothing is preselected: the page opens on the Flow Engine illustration.
  const selected = flows.find((f) => f.slug === selectedSlug) ?? null

  const choose = (slug: string) => {
    const next = new URLSearchParams(params)
    next.set('flow', slug)
    setParams(next, { replace: true })
  }

  return (
    <div className="px-6 py-10 sm:px-8 sm:py-12">
      <style>{`@keyframes flowStep { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
@keyframes accFly { 0% { transform: translate(0,0) scale(1); opacity: .9 } 45% { transform: translate(var(--dx),var(--dy)) scale(.25); opacity: .9 } 46%,100% { transform: translate(var(--dx),var(--dy)) scale(.25); opacity: 0 } }
@keyframes inputIn { 0%,35% { opacity: .25 } 55%,92% { opacity: 1 } 100% { opacity: .25 } }
.fc-fly { transform-box: fill-box; transform-origin: center; animation: accFly 6s ease-in infinite; animation-delay: calc(var(--i) * 40ms) }
@keyframes stepOn { 0%,18% { opacity: .35 } 28%,90% { opacity: 1 } 100% { opacity: .35 } }
.fc-step { animation: stepOn 6s ease-in-out infinite; animation-delay: calc(var(--i) * 380ms) }
@keyframes outIn { 0%,55% { opacity: .3 } 70%,92% { opacity: 1 } 100% { opacity: .3 } }
.fc-out { animation: outIn 6s ease-in-out infinite }
.fc-input { animation: inputIn 6s ease-in-out infinite; animation-delay: calc(var(--i) * 120ms) }
@media (prefers-reduced-motion: reduce) { li[style*="flowStep"], .fc-fly, .fc-input, .fc-step, .fc-out { animation: none !important } .fc-fly { opacity: 0 !important } .fc-input, .fc-step, .fc-out { opacity: 1 } }`}</style>
      <PageShell
        eyebrow="Flow Engine"
        title="Flows"
        description={
          <>
            Ready-made recipes that turn a few inputs into a transaction you can sign. Pick one on the left, fill in the inputs and run it against
            the live chain — nothing is signed or sent. Then copy the same call into your agent. See{' '}
            <a href="/docs/flow-engine" className="text-ink underline underline-offset-4 hover:no-underline">
              the docs
            </a>{' '}
            to publish your own.
          </>
        }
        className="space-y-6"
      >
        {error ? (
          <div role="alert" className="border border-[#b75000]/20 bg-[#b75000]/5 p-8 text-center text-sand-1400">
            {error}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            {/* Catalog */}
            <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start" aria-label="Flow catalog">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sand-1000" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${flows.length || ''} flows…`}
                  aria-label="Search flows"
                  className="input h-10 w-full pl-9 pr-9"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center text-sand-1100 hover:text-sand-1600">
                    <X className="size-4" />
                  </button>
                )}
              </div>

              <ProtocolSelect options={protocols} value={protocol} onChange={setProtocol} total={flows.length} />

              <div className="max-h-72 overflow-y-auto border border-border-low bg-bg1 lg:max-h-[calc(100vh-18rem)]">
                {isLoading ? (
                  <div className="space-y-2 p-3" aria-busy="true">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="h-8 animate-pulse bg-sand-200" />
                    ))}
                  </div>
                ) : groups.length === 0 ? (
                  <p className="p-4 text-sm text-sand-1200">No flows match. Try a different search.</p>
                ) : (
                  groups.map(([protocol, list]) => (
                    <div key={protocol}>
                      <p className="sticky top-0 z-10 flex items-center justify-between border-b border-border-low bg-sand-50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-sand-1100">
                        {protocol}
                        <span>{list.length}</span>
                      </p>
                      <ul>
                        {list.map((f) => {
                          const active = selected?.slug === f.slug
                          return (
                            <li key={f.slug}>
                              <button
                                type="button"
                                onClick={() => choose(f.slug)}
                                aria-current={active ? 'true' : undefined}
                                className={cn(
                                  'flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left transition-colors',
                                  active ? 'border-sand-1600 bg-sand-100' : 'border-transparent hover:bg-sand-50',
                                )}
                              >
                                <span className="w-16 shrink-0 truncate font-mono text-[10px] uppercase tracking-[0.06em] text-sand-1000">{pretty(f.intent)}</span>
                                <span className={cn('min-w-0 flex-1 truncate text-sm', active ? 'font-semibold text-sand-1600' : 'text-sand-1300')}>{f.meta.name}</span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            </aside>

            {/* Studio */}
            <main className="min-w-0 space-y-6" aria-live="polite">
              {/* The Flow Engine story: full size until a flow is opened, then it folds into one line. */}
              <div className={cn('grid transition-[grid-template-rows] duration-500 ease-in-out', selected ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]')} aria-hidden={selected ? 'true' : undefined}>
                <div className="overflow-hidden">
                  <section className="border border-border-low bg-bg1 p-4 sm:p-6">
                    <h2 className="text-lg font-semibold text-sand-1600 sm:text-xl">From dozens of accounts to a handful of inputs</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-sand-1200">
                      A raw Solana instruction makes you find, derive and order every account. A flow does that for you: you give it the few things only you
                      know, and the Flow Engine resolves the rest.
                    </p>
                    <div className="mt-4 overflow-x-auto">
                      <div className="min-w-[640px]">
                        <CollapseDiagram />
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-sand-1200">Pick a flow from the list to see its inputs and run it.</p>
                  </section>
                </div>
              </div>
              <div className={cn('grid transition-[grid-template-rows] duration-500 ease-in-out', selected ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')} aria-hidden={selected ? undefined : 'true'}>
                <div className="overflow-hidden">
                  <CollapseBar />
                </div>
              </div>

              {isLoading ? (
                <div className="space-y-4" aria-busy="true">
                  <div className="h-8 w-64 animate-pulse bg-sand-200" />
                  <div className="h-24 animate-pulse bg-sand-100" />
                </div>
              ) : selected ? (
                <Studio flow={selected} />
              ) : flows.length === 0 ? (
                <div className="border border-dashed border-border-low bg-sand-50 px-6 py-16 text-center">
                  <p className="font-semibold text-sand-1600">No published flows yet</p>
                  <p className="mt-1 text-sm text-sand-1200">Flows are authored and published via the Flow Engine MCP server — see the docs to get started.</p>
                </div>
              ) : null}
            </main>
          </div>
        )}
      </PageShell>
    </div>
  )
}
