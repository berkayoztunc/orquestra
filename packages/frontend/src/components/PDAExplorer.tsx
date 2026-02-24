import { useState, useMemo } from 'react'
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

export default function PDAExplorer({
  projectId,
  programId,
  pdaAccounts,
}: PDAExplorerProps): JSX.Element {
  const [selectedIx, setSelectedIx] = useState<string | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [seedValues, setSeedValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<any>(null)
  const [isDeriving, setIsDeriving] = useState(false)
  const { showToast } = useToast()

  // Group PDA accounts by instruction
  const byInstruction = useMemo(() => {
    const map: Record<string, PdaAccountInfo[]> = {}
    for (const pda of pdaAccounts) {
      if (!map[pda.instruction]) map[pda.instruction] = []
      map[pda.instruction].push(pda)
    }
    return map
  }, [pdaAccounts])

  const instructionNames = Object.keys(byInstruction)

  const accountsForIx = selectedIx ? byInstruction[selectedIx] || [] : []
  const selectedPda = accountsForIx.find((a) => a.account === selectedAccount)

  const handleSelectIx = (name: string) => {
    setSelectedIx(name === selectedIx ? null : name)
    setSelectedAccount(null)
    setSeedValues({})
    setResult(null)
  }

  const handleSelectAccount = (name: string) => {
    setSelectedAccount(name === selectedAccount ? null : name)
    setSeedValues({})
    setResult(null)
  }

  const handleDerive = async () => {
    if (!selectedIx || !selectedAccount || !selectedPda) return
    setIsDeriving(true)
    setResult(null)

    try {
      // Parse numeric values for arg seeds
      const parsedValues: Record<string, any> = {}
      for (const seed of selectedPda.seeds) {
        if (seed.kind === 'const') continue
        const name = seed.name || ''
        const val = seedValues[name] || ''
        if (seed.kind === 'arg' && seed.type) {
          const t = seed.type
          if (/^[ui](8|16|32|64|128)$/.test(t)) {
            parsedValues[name] = val
          } else {
            parsedValues[name] = val
          }
        } else {
          parsedValues[name] = val
        }
      }

      const data = await derivePda(projectId, {
        instruction: selectedIx,
        account: selectedAccount,
        seedValues: parsedValues,
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

  const userSeeds = selectedPda?.seeds.filter((s) => s.kind !== 'const') || []
  const allFilled = userSeeds.every((s) => seedValues[s.name || '']?.trim())

  const generateCurlSnippet = (): string => {
    if (!selectedIx || !selectedAccount || !selectedPda) return ''
    const apiBase = import.meta.env.VITE_WORKER_URL || 'https://api.orquestra.dev'
    const body = JSON.stringify(
      { instruction: selectedIx, account: selectedAccount, seedValues },
      null,
      2,
    )
    return `curl -X POST ${apiBase}/api/${projectId}/pda/derive \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`
  }

  if (pdaAccounts.length === 0) {
    return (
      <div className="card-static p-8 text-center">
        <p className="text-gray-400">No PDA accounts found in this IDL</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Step 1: Pick instruction */}
      <div>
        <h4 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold">
            1
          </span>
          Select Instruction
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {instructionNames.map((name) => (
            <button
              key={name}
              onClick={() => handleSelectIx(name)}
              className={`text-left p-4 rounded-xl border transition-all duration-200 ${
                selectedIx === name
                  ? 'bg-primary/10 border-primary shadow-lg shadow-primary/10'
                  : 'bg-surface-card border-white/5 hover:border-primary/30 hover:bg-surface-elevated'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <h4 className="font-mono font-bold text-sm text-white truncate">{name}</h4>
                {selectedIx === name && (
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                )}
              </div>
              <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded">
                {byInstruction[name].length} PDA{byInstruction[name].length > 1 ? 's' : ''}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Step 2: Pick PDA account */}
      {selectedIx && accountsForIx.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold">
              2
            </span>
            Select PDA Account
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {accountsForIx.map((pda) => (
              <button
                key={pda.account}
                onClick={() => handleSelectAccount(pda.account)}
                className={`text-left p-4 rounded-xl border transition-all duration-200 ${
                  selectedAccount === pda.account
                    ? 'bg-secondary/10 border-secondary shadow-lg shadow-secondary/10'
                    : 'bg-surface-card border-white/5 hover:border-secondary/30 hover:bg-surface-elevated'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-mono font-bold text-sm text-white truncate">{pda.account}</h4>
                  {selectedAccount === pda.account && (
                    <div className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pda.seeds.map((s, i) => (
                    <span
                      key={i}
                      className={`text-xs px-2 py-0.5 rounded ${
                        s.kind === 'const'
                          ? 'bg-gray-700/50 text-gray-400'
                          : s.kind === 'arg'
                          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                          : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                      }`}
                    >
                      {s.kind === 'const' ? `"${s.description}"` : `${s.kind}:${s.name}`}
                    </span>
                  ))}
                </div>
                {pda.customProgram && (
                  <p className="text-xs text-yellow-400 mt-2 truncate">
                    Program: {pda.customProgram.slice(0, 8)}...
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Fill seed values & derive */}
      {selectedPda && (
        <div className="card-static p-6 space-y-6">
          <div className="flex items-center gap-3">
            <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold">
              3
            </span>
            <h3 className="text-lg font-bold text-white">
              Derive: <span className="text-primary font-mono">{selectedAccount}</span>
            </h3>
          </div>

          {/* Seed overview */}
          <div>
            <h4 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              Seeds
            </h4>
            <div className="space-y-2">
              {/* Const seeds (read-only) */}
              {selectedPda.seeds
                .filter((s) => s.kind === 'const')
                .map((s, i) => (
                  <div key={`const-${i}`} className="flex items-center gap-3 p-3 bg-surface-elevated rounded-xl">
                    <span className="w-16 text-xs text-gray-500 flex-shrink-0 uppercase tracking-wider">
                      const
                    </span>
                    <span className="font-mono text-sm text-gray-400">
                      "{s.description}"
                    </span>
                  </div>
                ))}

              {/* User-provided seeds */}
              {userSeeds.map((s) => (
                <div key={s.name} className="flex items-center gap-3 p-3 bg-surface-elevated rounded-xl">
                  <label className="w-40 text-sm font-mono text-gray-300 flex items-center gap-2 flex-shrink-0">
                    <span className="truncate">{s.name}</span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        s.kind === 'arg'
                          ? 'bg-blue-500/10 text-blue-400'
                          : 'bg-purple-500/10 text-purple-400'
                      }`}
                    >
                      {s.kind === 'arg' ? s.type || 'arg' : 'pubkey'}
                    </span>
                  </label>
                  <input
                    type="text"
                    value={seedValues[s.name || ''] || ''}
                    onChange={(e) =>
                      setSeedValues({ ...seedValues, [s.name || '']: e.target.value })
                    }
                    placeholder={
                      s.kind === 'account'
                        ? 'Public key (base58)...'
                        : s.type === 'string'
                        ? 'Text value...'
                        : s.type
                        ? `${s.type} value...`
                        : 'Value...'
                    }
                    className="input flex-1 text-sm font-mono"
                  />
                </div>
              ))}
            </div>
          </div>

          {selectedPda.customProgram && (
            <div className="flex items-center gap-2 text-sm p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
              <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-yellow-400">
                Cross-program PDA — derived against{' '}
                <code className="text-xs bg-yellow-500/10 px-1.5 py-0.5 rounded">
                  {selectedPda.customProgram}
                </code>
              </span>
            </div>
          )}

          {/* Derive button */}
          <button
            onClick={handleDerive}
            disabled={isDeriving || !allFilled}
            className="btn-primary w-full md:w-auto px-8 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDeriving ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Deriving...
              </span>
            ) : (
              'Derive PDA'
            )}
          </button>

          {/* Result */}
          {result && (
            <div className="space-y-4">
              <div className="p-5 bg-primary/5 border border-primary/20 rounded-xl space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">PDA Address</p>
                    <code className="text-primary font-mono text-sm break-all">{result.pda}</code>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(result.pda)
                      showToast('Copied PDA address', 'success')
                    }}
                    className="text-gray-500 hover:text-primary transition-colors flex-shrink-0"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Bump</p>
                    <span className="text-white font-mono font-bold text-lg">{result.bump}</span>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Program</p>
                    <code className="text-gray-400 font-mono text-xs break-all">{result.programId}</code>
                  </div>
                </div>
              </div>

              {/* Seeds breakdown */}
              {result.seeds?.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Seed Bytes</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-500 border-b border-white/5">
                          <th className="text-left py-2 pr-4 font-medium">#</th>
                          <th className="text-left py-2 pr-4 font-medium">Kind</th>
                          <th className="text-left py-2 pr-4 font-medium">Name / Value</th>
                          <th className="text-left py-2 font-medium">Hex</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.seeds.map((s: any, i: number) => (
                          <tr key={i} className="border-b border-white/5 last:border-0">
                            <td className="py-2.5 pr-4 text-gray-500">{i + 1}</td>
                            <td className="py-2.5 pr-4">
                              <span
                                className={`text-xs px-2 py-0.5 rounded ${
                                  s.kind === 'const'
                                    ? 'bg-gray-700/50 text-gray-400'
                                    : s.kind === 'arg'
                                    ? 'bg-blue-500/10 text-blue-400'
                                    : 'bg-purple-500/10 text-purple-400'
                                }`}
                              >
                                {s.kind}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4 font-mono text-gray-300 text-xs">
                              {s.description || s.name || '-'}
                              {s.value !== undefined && s.kind !== 'const' && (
                                <span className="text-gray-500 ml-1">= {String(s.value)}</span>
                              )}
                            </td>
                            <td className="py-2.5 font-mono text-gray-500 text-xs break-all max-w-xs">
                              {s.hex}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* cURL snippet */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">cURL</p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(generateCurlSnippet())
                      showToast('Copied cURL command', 'success')
                    }}
                    className="text-xs text-gray-500 hover:text-primary transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <pre className="text-xs text-gray-400 font-mono bg-surface-elevated p-4 rounded-xl overflow-x-auto whitespace-pre-wrap">
                  {generateCurlSnippet()}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
