import { useState } from 'react'
import { useToast } from '../components/Toast'
import { derivePda } from '../api/client'

interface SeedInfo {
  kind: string
  name?: string
  description?: string
  type?: string
}

interface PdaAccountInfo {
  instruction: string
  account: string
  seeds: SeedInfo[]
  customProgram: string | null
}

interface PDAExplorerProps {
  projectId: string
  programId: string
  pdaAccounts: PdaAccountInfo[]
}

interface DeduplicatedPda extends PdaAccountInfo {
  instructions: string[] // all instructions that share this PDA
}

// ── Single accordion card ────────────────────────────────────────────────────
function PDACard({
  pda,
  projectId,
}: {
  pda: DeduplicatedPda
  projectId: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [seedValues, setSeedValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<any>(null)
  const [isDeriving, setIsDeriving] = useState(false)
  const { showToast } = useToast()

  const apiBase = import.meta.env.VITE_WORKER_URL || 'https://api.orquestra.dev'
  const endpoint = `/api/${projectId}/pda/derive`
  const userSeeds = pda.seeds.filter((s) => s.kind !== 'const')
  const constSeeds = pda.seeds.filter((s) => s.kind === 'const')
  const allFilled = userSeeds.every((s) => seedValues[s.name || '']?.trim())

  const generateCurlSnippet = (): string => {
    const body = JSON.stringify(
      { instruction: pda.instruction, account: pda.account, seedValues },
      null,
      2,
    )
    return `curl -X POST ${apiBase}${endpoint} \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`
  }

  const handleDerive = async () => {
    setIsDeriving(true)
    setResult(null)
    try {
      const data = await derivePda(projectId, {
        instruction: pda.instruction,
        account: pda.account,
        seedValues,
      })
      setResult(data)
      showToast('PDA derived successfully', 'success')
    } catch (err: any) {
      const msg =
        err.response?.data?.details ||
        err.response?.data?.error ||
        err.message ||
        'Derivation failed'
      showToast(typeof msg === 'string' ? msg : JSON.stringify(msg), 'error')
    } finally {
      setIsDeriving(false)
    }
  }

  const handleToggle = () => {
    setOpen((v) => !v)
    if (open) setResult(null)
  }

  return (
    <div className={`rounded-xl transition-all duration-200 overflow-hidden bg-surface-card ${open ? 'ring-1 ring-primary/30 shadow-lg shadow-primary/5' : 'ring-1 ring-white/5 hover:ring-white/10'}`}>
      {/* ── Accordion Header ── */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left bg-surface-card hover:bg-surface-elevated transition-colors"
      >
        {/* POST badge */}
        <span className="flex-shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-md bg-violet-500/15 text-violet-400 border border-violet-500/25 font-mono tracking-wide">
          POST
        </span>

        {/* Short endpoint */}
        <span className="flex-shrink-0 text-xs font-mono text-gray-500 hidden sm:block">
          /pda/derive
        </span>

        {/* Account name */}
        <span className="font-mono font-semibold text-sm text-white truncate flex-1">
          {pda.account}
        </span>

        {/* CPI badge — only shown when this PDA is shared across multiple instructions */}
        {pda.instructions.length > 1 && (
          <span className="text-[11px] font-bold text-violet-300 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-md flex-shrink-0 font-mono">
            CPI ×{pda.instructions.length}
          </span>
        )}

        {/* Seed count */}
        <span className="text-[11px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-md font-mono flex-shrink-0">
          {pda.seeds.length} seed{pda.seeds.length !== 1 ? 's' : ''}
        </span>

        {/* Custom program indicator */}
        {pda.customProgram && (
          <span className="text-[11px] text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-md flex-shrink-0 hidden lg:block">
            cross-program
          </span>
        )}

        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* ── Expanded Body ── */}
      {open && (
        <div className="border-t border-black/30">
          <div className="flex flex-col lg:flex-row">

            {/* ── LEFT: Seed Schema ── */}
            <div className="lg:w-[45%] p-5 space-y-5 bg-surface-card border-r border-black/30">
              {/* Endpoint + copy */}
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-black/20">
                <span className="text-[11px] font-bold text-violet-400 font-mono bg-violet-500/10 px-2 py-0.5 rounded flex-shrink-0">POST</span>
                <code className="text-xs font-mono text-gray-300 truncate flex-1">{apiBase}{endpoint}</code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`${apiBase}${endpoint}`)
                    showToast('Endpoint copied', 'success')
                  }}
                  className="flex-shrink-0 text-gray-500 hover:text-primary transition-colors"
                  title="Copy endpoint"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>

              {/* Instructions using this PDA */}
              {pda.instructions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Used by</p>
                  <div className="flex flex-wrap gap-1.5">
                    {pda.instructions.map((ix) => (
                      <span key={ix} className="text-[11px] font-mono text-gray-400 bg-white/5 px-2 py-1 rounded-md">
                        {ix}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500">Seeds</h4>

              {/* Seed schema list */}
              <div className="rounded-lg overflow-hidden bg-black/20">
                {constSeeds.map((s, i) => (
                  <div key={`c-${i}`} className="flex items-center justify-between px-3 py-2.5 border-b border-black/20 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-gray-400 italic">"{s.description}"</span>
                    </div>
                    <span className="text-[11px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded font-mono">const</span>
                  </div>
                ))}
                {userSeeds.map((s) => (
                  <div key={s.name} className="flex items-center justify-between px-3 py-2.5 border-b border-black/20 last:border-0">
                    <span className="font-mono text-sm text-white">{s.name}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${
                        s.kind === 'arg'
                          ? 'text-blue-400 bg-blue-500/10 border-blue-500/20'
                          : 'text-purple-400 bg-purple-500/10 border-purple-500/20'
                      }`}>
                        {s.kind === 'arg' ? s.type || 'arg' : 'pubkey'}
                      </span>
                      <span className="text-[11px] text-gray-600 font-mono bg-white/5 px-1.5 py-0.5 rounded">{s.kind}</span>
                    </div>
                  </div>
                ))}
              </div>

              {pda.customProgram && (
                <div className="flex items-center gap-2 text-xs p-2.5 bg-yellow-500/5 rounded-lg">
                  <svg className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-yellow-400">Cross-program: <code className="font-mono">{pda.customProgram.slice(0, 8)}…</code></span>
                </div>
              )}

              {/* cURL example */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-500">cURL Example</p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(generateCurlSnippet())
                      showToast('cURL copied to clipboard', 'success')
                    }}
                    className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-primary transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </button>
                </div>
                <pre className="text-[11px] font-mono text-gray-400 bg-black/30 rounded-lg p-3 whitespace-pre-wrap leading-relaxed overflow-x-auto">{generateCurlSnippet()}</pre>
              </div>
            </div>

            {/* ── RIGHT: Try It Out ── */}
            <div className="lg:flex-1 p-5 space-y-5">
              <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500">Try it out</h4>

              {userSeeds.length === 0 ? (
                <p className="text-xs text-gray-600 italic">No inputs required — all seeds are constants</p>
              ) : (
                <div className="space-y-3">
                  {userSeeds.map((s) => (
                    <div key={s.name} className="space-y-1">
                      <label className="flex items-center gap-2 text-xs font-mono text-gray-400">
                        {s.name}
                        <span className="text-red-400">*</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          s.kind === 'arg'
                            ? 'text-blue-400 bg-blue-400/10'
                            : 'text-purple-400 bg-purple-400/10'
                        }`}>
                          {s.kind === 'arg' ? s.type || 'arg' : 'pubkey'}
                        </span>
                      </label>
                      <input
                        type="text"
                        value={seedValues[s.name || ''] || ''}
                        onChange={(e) => setSeedValues({ ...seedValues, [s.name || '']: e.target.value })}
                        placeholder={
                          s.kind === 'account'
                            ? 'Public key (base58)...'
                            : s.type === 'string'
                            ? 'Text value...'
                            : s.type
                            ? `${s.type} value...`
                            : 'Value...'
                        }
                        className="input w-full text-sm font-mono"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Derive button */}
              <button
                onClick={handleDerive}
                disabled={isDeriving || !allFilled}
                className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isDeriving ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Deriving...
                  </span>
                ) : (
                  'Derive PDA'
                )}
              </button>

              {/* Result */}
              {result && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-emerald-500/15">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/25 px-2 py-0.5 rounded-md">
                        200 OK
                      </span>
                      <span className="text-xs text-gray-500">PDA derived</span>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(result.pda)
                        showToast('Copied PDA address', 'success')
                      }}
                      className="text-xs text-primary hover:text-secondary transition-colors"
                    >
                      Copy address
                    </button>
                  </div>

                  <div className="p-4 space-y-4">
                    {/* PDA address */}
                    <div>
                      <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">PDA Address</p>
                      <code className="text-primary font-mono text-sm break-all">{result.pda}</code>
                    </div>

                    {/* Bump + program */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">Bump</p>
                        <span className="text-white font-mono font-bold text-lg">{result.bump}</span>
                      </div>
                      <div>
                        <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">Program</p>
                        <code className="text-gray-400 font-mono text-xs break-all">{result.programId}</code>
                      </div>
                    </div>

                    {/* Seeds breakdown */}
                    {result.seeds?.length > 0 && (
                      <div>
                        <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">Seed Bytes</p>
                        <div className="rounded-lg overflow-hidden bg-black/20">
                          {result.seeds.map((s: any, i: number) => (
                            <div key={i} className="flex items-center gap-3 px-3 py-2 border-b border-black/20 last:border-0 text-xs">
                              <span className="text-gray-600 font-mono w-4 flex-shrink-0">{i + 1}</span>
                              <span className={`px-1.5 py-0.5 rounded font-mono flex-shrink-0 ${
                                s.kind === 'const'
                                  ? 'bg-gray-700/50 text-gray-400'
                                  : s.kind === 'arg'
                                  ? 'bg-blue-500/10 text-blue-400'
                                  : 'bg-purple-500/10 text-purple-400'
                              }`}>{s.kind}</span>
                              <span className="font-mono text-gray-300 truncate flex-1">
                                {s.description || s.name || '-'}
                                {s.value !== undefined && s.kind !== 'const' && (
                                  <span className="text-gray-500 ml-1">= {String(s.value)}</span>
                                )}
                              </span>
                              <span className="font-mono text-gray-600 text-[10px] break-all max-w-[120px] truncate">{s.hex}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main explorer ────────────────────────────────────────────────────────────
export default function PDAExplorer({
  projectId,
  programId: _programId,
  pdaAccounts,
}: PDAExplorerProps): JSX.Element {
  if (pdaAccounts.length === 0) {
    return (
      <div className="card-static p-8 text-center">
        <p className="text-gray-400">No PDA accounts found in this IDL</p>
      </div>
    )
  }

  // Deduplicate: same account name + same seed structure → single card
  // Keep the first instruction for derivation; collect all instruction names for display
  const deduped = Object.values(
    pdaAccounts.reduce<Record<string, DeduplicatedPda>>((acc, pda) => {
      const key = `${pda.account}::${JSON.stringify(pda.seeds)}`
      if (acc[key]) {
        if (!acc[key].instructions.includes(pda.instruction)) {
          acc[key].instructions.push(pda.instruction)
        }
      } else {
        acc[key] = { ...pda, instructions: [pda.instruction] }
      }
      return acc
    }, {}),
  )

  return (
    <div className="space-y-2">
      {deduped.map((pda) => (
        <PDACard key={pda.account} pda={pda} projectId={projectId} />
      ))}
    </div>
  )
}


