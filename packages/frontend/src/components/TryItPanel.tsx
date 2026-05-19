import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ZapIcon, CheckIcon, AlertCircleIcon, CopyIcon, ExternalLinkIcon } from 'lucide-react'
import { listProjects, listInstructions, buildTransaction } from '../api/client'
import CodeBlock from './CodeBlock'

type Stage = 'idle' | 'fetching' | 'building' | 'done' | 'error'

interface Demo {
  projectId: string
  programId: string
  programName: string
  instruction: string
  accounts: Record<string, string>
  args: Record<string, unknown>
  feePayer: string
}

const FALLBACK_FEE_PAYER = '11111111111111111111111111111112'

const PRESET_DEMOS: Demo[] = [
  {
    projectId: 'p7o7nf4pucllzadrmiqhf',
    programId: 'BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya',
    programName: 'Let Me Buy',
    instruction: 'make_purchase',
    accounts: {
      receipts: 'H7BjEBtan8h1HXeM38fHNPN7WxQswDhF8PFwnTuQDt5V',
      signer: '8drh4w7p1Mfw4YAkDAswoRwuD1V9sPY1UM2o2xr8kAqu',
      authority: '8D8qFHBnvS6oMsJy7EmGTrpoZcGd3aCC3pnPLi93Ag2V',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      sender_token_account: 'AR6ENLPSohwVxUdgkd2uAshWBvsVEwtrgMx2iAnQwQUs',
      recipient_token_account: 'FaK5981JTnAbraeKQTjptKAHiF74Zy4upg2hoBdLnGyY',
      token_program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      system_program: '11111111111111111111111111111111',
      associated_token_program: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    },
    args: { store_name: 'jonasbar', product_name: 'Water', table_number: 11 },
    feePayer: '8drh4w7p1Mfw4YAkDAswoRwuD1V9sPY1UM2o2xr8kAqu',
  },
]

function shortenBase58(s: string, take = 8): string {
  if (!s || s.length <= take * 2 + 1) return s
  return `${s.slice(0, take)}…${s.slice(-take)}`
}

function buildCurl(demo: Demo): string {
  const body = {
    accounts: demo.accounts,
    args: demo.args,
    feePayer: demo.feePayer,
  }
  return `curl -X POST https://api.orquestra.dev/api/${demo.projectId}/instructions/${demo.instruction}/build \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(body, null, 2)}'`
}

export default function TryItPanel(): JSX.Element {
  const [demo, setDemo] = useState<Demo | null>(PRESET_DEMOS[0])
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    transaction: string
    estimatedFee: number
    rpcUrlHost?: string
    network?: string
    accounts?: Array<{ name: string; pubkey: string; isSigner: boolean; isWritable: boolean }>
  } | null>(null)
  const [copied, setCopied] = useState<'curl' | 'tx' | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [autoTriggered, setAutoTriggered] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function pickDemo() {
      setStage('fetching')
      try {
        const list = await listProjects({ limit: 5, search: 'let me buy' })
        const projects = list?.projects || []
        const candidate = projects[0]
        if (!candidate || cancelled) {
          setStage('idle')
          return
        }
        const projectId = candidate.id as string
        if (cancelled) return
        const preset = PRESET_DEMOS.find((d) => d.projectId === projectId)
        if (preset) {
          setDemo(preset)
          setStage('idle')
          return
        }
        const ixResp = await listInstructions(projectId)
        const instructions: Array<{ name: string; accounts: any[]; args: any[] }> = ixResp?.instructions || []
        const deposit = instructions.find((i) => /deposit|stake/i.test(i.name)) || instructions[0]
        if (!deposit || cancelled) {
          setStage('idle')
          return
        }
        const accounts: Record<string, string> = {}
        for (const a of deposit.accounts) {
          if (!a.isOptional) accounts[a.name] = FALLBACK_FEE_PAYER
        }
        const args: Record<string, unknown> = {}
        for (const a of deposit.args) {
          args[a.name] = /u8|u16|u32|u64|i\d+|f\d+/.test(a.type) ? 1_000_000 : ''
        }
        if (cancelled) return
        setDemo({
          projectId,
          programId: candidate.program_id || candidate.programId || '',
          programName: candidate.name || projectId,
          instruction: deposit.name,
          accounts,
          args,
          feePayer: FALLBACK_FEE_PAYER,
        })
        setStage('idle')
      } catch {
        if (!cancelled) setStage('idle')
      }
    }
    pickDemo()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (autoTriggered) return
    if (!demo) return
    if (stage !== 'idle') return
    const timer = setTimeout(() => {
      setAutoTriggered(true)
      handleRun()
    }, 1800)
    return () => clearTimeout(timer)
  }, [demo, stage])

  async function handleRun() {
    if (!demo) return
    setStage('building')
    setError(null)
    setResult(null)
    setElapsedMs(null)
    const t0 = performance.now()
    try {
      const data = await buildTransaction(demo.projectId, demo.instruction, {
        accounts: demo.accounts,
        args: demo.args,
        feePayer: demo.feePayer,
      })
      const t1 = performance.now()
      setElapsedMs(Math.round(t1 - t0))
      setResult({
        transaction: data.transaction,
        estimatedFee: data.estimatedFee ?? 5000,
        rpcUrlHost: data.rpcUrlHost,
        network: data.network,
        accounts: data.instruction?.accounts || data.accounts,
      })
      setStage('done')
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Build failed'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
      setStage('error')
    }
  }

  async function copy(kind: 'curl' | 'tx') {
    if (!demo) return
    const text = kind === 'curl' ? buildCurl(demo) : (result?.transaction ?? '')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      /* noop */
    }
  }

  if (!demo) return <></>

  const requestBlock = JSON.stringify(
    {
      accounts: demo.accounts,
      args: demo.args,
      feePayer: demo.feePayer,
    },
    null,
    2,
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center border border-border-low bg-sand-50"
            style={{
              backgroundImage:
                'repeating-linear-gradient(-45deg, transparent, transparent 4px, rgb(var(--rgb-border-low) / 0.7) 4px, rgb(var(--rgb-border-low) / 0.7) 5px)',
            }}
          >
            <ZapIcon className="h-4 w-4 text-sand-1600" aria-hidden="true" />
          </span>
          <div>
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-sand-1100">
              Live demo
              <span className="inline-flex items-center gap-1 border border-[#b75000]/30 bg-[#b75000]/10 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-[#b75000]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#b75000]" />
                LIVE
              </span>
            </p>
            <p className="mt-1 text-base font-semibold text-sand-1600">
              Build a real Solana transaction from{' '}
              <span className="text-sand-1400">{demo.programName}</span>
              <span className="font-normal text-sand-1100"> · </span>
              <code className="font-mono text-sm text-sand-1200">{demo.instruction}</code>
            </p>
          </div>
        </div>
        <button
          onClick={handleRun}
          disabled={stage === 'building' || stage === 'fetching'}
          className="btn-primary self-start disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
        >
          {stage === 'building' ? 'Building…' : stage === 'done' ? 'Run Again' : 'Run Live'}
        </button>
      </div>

      {/* Request / Response columns */}
      <div className="grid gap-px overflow-hidden border border-border-low bg-border-low md:grid-cols-2">
        {/* Request */}
        <div className="bg-sand-50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-sand-1100">request</p>
            <button
              onClick={() => copy('curl')}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-sand-1200 transition-colors hover:text-sand-1600"
            >
              {copied === 'curl' ? (
                <>
                  <CheckIcon className="h-3 w-3" /> copied
                </>
              ) : (
                <>
                  <CopyIcon className="h-3 w-3" /> copy as curl
                </>
              )}
            </button>
          </div>
          <CodeBlock language="json" code={requestBlock} copyable={false} />
          <p className="mt-3 font-mono text-[11px] text-sand-1100">
            POST /api/{demo.projectId}/instructions/{demo.instruction}/build
          </p>
        </div>

        {/* Response */}
        <div className="bg-sand-50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-sand-1100">response</p>
            {elapsedMs !== null && (
              <span className="font-mono text-[11px] text-sand-1200">{elapsedMs}ms</span>
            )}
          </div>

          {stage === 'idle' && !result && (
            <div className=" border border-dashed border-border-medium px-4 py-8 text-center">
              <p className="text-sm text-sand-1200">
                Click <span className="font-medium text-sand-1600">Run Live</span> to call the public
                Orquestra API. No signup, no API key.
              </p>
            </div>
          )}

          {stage === 'fetching' && (
            <div className=" border border-border-low px-4 py-8 text-center">
              <p className="animate-pulse text-sm text-sand-1200">Discovering live program…</p>
            </div>
          )}

          {stage === 'building' && (
            <div className=" border border-border-medium bg-sand-100 px-4 py-8 text-center">
              <p className="animate-pulse text-sm text-sand-1600">Building transaction at the edge…</p>
            </div>
          )}

          {stage === 'error' && (
            <div className=" border border-[#b75000]/30 bg-[#b75000]/5 p-4">
              <div className="flex items-start gap-2">
                <AlertCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#b75000]" />
                <div className="text-sm">
                  <p className="mb-1 font-medium text-[#b75000]">Build failed</p>
                  <p className="break-all font-mono text-xs leading-relaxed text-[#b75000]/70">
                    {error}
                  </p>
                  <p className="mt-2 text-xs text-sand-1200">
                    The error itself proves the API is live — the demo accounts may be stale.{' '}
                    <Link to="/explorer" className="text-sand-1600 underline hover:no-underline">
                      Try a real one →
                    </Link>
                  </p>
                </div>
              </div>
            </div>
          )}

          {stage === 'done' && result && (
            <div className="space-y-3">
              <div className=" border border-border-medium bg-sand-100 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <CheckIcon className="h-4 w-4 text-sand-1500" />
                  <p className="text-sm font-medium text-sand-1600">Base58 transaction ready</p>
                </div>
                <p className="break-all font-mono text-xs leading-relaxed text-sand-1200">
                  {shortenBase58(result.transaction, 36)}
                </p>
                <button
                  onClick={() => copy('tx')}
                  className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] text-sand-1200 transition-colors hover:text-sand-1600"
                >
                  {copied === 'tx' ? (
                    <>
                      <CheckIcon className="h-3 w-3" /> copied
                    </>
                  ) : (
                    <>
                      <CopyIcon className="h-3 w-3" /> copy full transaction
                    </>
                  )}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className=" border border-border-low bg-bg1 px-3 py-2">
                  <p className="mb-0.5 font-mono uppercase tracking-[0.12em] text-sand-1100">est. fee</p>
                  <p className="font-mono text-sand-1600">
                    {result.estimatedFee.toLocaleString()} lamports
                  </p>
                </div>
                <div className=" border border-border-low bg-bg1 px-3 py-2">
                  <p className="mb-0.5 font-mono uppercase tracking-[0.12em] text-sand-1100">network</p>
                  <p className="font-mono text-sand-1600">{result.network ?? 'mainnet-beta'}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer CTA */}
      <div className="flex flex-col gap-3 border-t border-border-low pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-sand-1200">
          Want this from your AI agent? Same call works as an MCP tool —{' '}
          <code className="font-mono text-sand-1600">build_instruction</code>.
        </p>
        <div className="flex items-center gap-4">
          <Link
            to="/docs/mcp"
            className="inline-flex items-center gap-1 text-xs text-sand-1200 transition-colors hover:text-sand-1600"
          >
            Open in MCP <ExternalLinkIcon className="h-3 w-3" />
          </Link>
          <Link
            to="/explorer"
            className="inline-flex items-center gap-1 text-xs font-medium text-sand-1600 transition-colors hover:text-sand-1200"
          >
            Browse 1,000+ programs →
          </Link>
        </div>
      </div>
    </div>
  )
}
