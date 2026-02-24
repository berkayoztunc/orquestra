import { useState } from 'react'
import { useToast } from '../components/Toast'
import { buildTransaction } from '../api/client'

interface FieldInfo {
  name: string
  type: string
  isDefinedType?: boolean
  nestedFields?: FieldInfo[] | null
}

interface ArgInfo {
  name: string
  type: string
  isDefinedType?: boolean
  definedTypeName?: string | null
  fields?: FieldInfo[] | null
}

interface InstructionExplorerProps {
  projectId: string
  instructions: Array<{
    name: string
    docs?: string[]
    accountCount: number
    argCount: number
    accounts: Array<{
      name: string
      isMut: boolean
      isSigner: boolean
      isOptional: boolean
    }>
    args: ArgInfo[]
  }>
  programId: string
}

// Helper to ensure docs is an array of strings
function ensureDocs(docs: any): string[] {
  if (Array.isArray(docs)) {
    return docs.filter((d) => typeof d === 'string')
  }
  return []
}

export default function InstructionExplorer({
  projectId,
  instructions,
}: InstructionExplorerProps): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const [accountValues, setAccountValues] = useState<Record<string, string>>({})
  const [argValues, setArgValues] = useState<Record<string, string>>({})
  const [feePayer, setFeePayer] = useState('')
  const [result, setResult] = useState<any>(null)
  const [isBuilding, setIsBuilding] = useState(false)
  const { showToast } = useToast()

  const selectedIx = instructions.find((ix) => ix.name === selected)

  const handleSelectInstruction = (name: string) => {
    setSelected(name === selected ? null : name)
    setAccountValues({})
    setArgValues({})
    setResult(null)
  }

  const handleBuild = async () => {
    if (!selected || !selectedIx) return
    setIsBuilding(true)

    try {
      const parsedArgs: Record<string, any> = {}
      for (const arg of selectedIx.args) {
        if (arg.isDefinedType && arg.fields) {
          const structObj: Record<string, any> = {}
          for (const field of arg.fields) {
            const fieldKey = `${arg.name}.${field.name}`
            const val = argValues[fieldKey] || ''
            structObj[field.name] = parseFieldValue(val, field.type)
          }
          parsedArgs[arg.name] = structObj
        } else {
          const val = argValues[arg.name] || ''
          parsedArgs[arg.name] = parseFieldValue(val, arg.type)
        }
      }

      const data = await buildTransaction(projectId, selected, {
        accounts: accountValues,
        args: parsedArgs,
        feePayer,
      })

      setResult(data)
      showToast('Transaction built successfully', 'success')
    } catch (err: any) {
      showToast(
        err.response?.data?.error ||
          err.response?.data?.details?.join(', ') ||
          'Build failed',
        'error'
      )
    } finally {
      setIsBuilding(false)
    }
  }

  const parseFieldValue = (val: string, type: string): any => {
    if (type.includes('u') || type.includes('i') || type.includes('f')) {
      return Number(val) || 0
    } else if (type === 'bool') {
      return val === 'true'
    }
    return val
  }

  const generateCurlSnippet = (): string => {
    if (!selected || !selectedIx) return ''
    const apiBase = import.meta.env.VITE_WORKER_URL || 'https://api.orquestra.dev'
    const parsedArgs: Record<string, any> = {}
    for (const arg of selectedIx.args) {
      if (arg.isDefinedType && arg.fields) {
        const structObj: Record<string, any> = {}
        for (const field of arg.fields) {
          const fieldKey = `${arg.name}.${field.name}`
          const val = argValues[fieldKey] || ''
          structObj[field.name] = parseFieldValue(val, field.type)
        }
        parsedArgs[arg.name] = structObj
      } else {
        const val = argValues[arg.name] || ''
        parsedArgs[arg.name] = parseFieldValue(val, arg.type)
      }
    }
    const body = JSON.stringify({ accounts: accountValues, args: parsedArgs, feePayer }, null, 2)
    return `curl -X POST ${apiBase}/api/${projectId}/instructions/${selected}/build \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`
  }

  if (instructions.length === 0) {
    return (
      <div className="card-static p-8 text-center">
        <p className="text-gray-400">No instructions defined in this IDL</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Instruction List - Modern Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {instructions.map((ix) => (
          <button
            key={ix.name}
            onClick={() => handleSelectInstruction(ix.name)}
            className={`text-left p-4 rounded-xl border transition-all duration-200 ${
              selected === ix.name
                ? 'bg-primary/10 border-primary shadow-lg shadow-primary/10'
                : 'bg-surface-card border-white/5 hover:border-primary/30 hover:bg-surface-elevated'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-mono font-bold text-sm text-white truncate">{ix.name}</h4>
              {selected === ix.name && (
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              )}
            </div>
            <div className="flex gap-2 text-xs text-gray-500">
              <span className="bg-white/5 px-2 py-0.5 rounded">{ix.accountCount} accounts</span>
              <span className="bg-white/5 px-2 py-0.5 rounded">{ix.argCount} args</span>
            </div>
            {ix.docs && ensureDocs(ix.docs)?.[0] && (
              <p className="text-xs text-gray-500 mt-2 truncate">{ensureDocs(ix.docs)[0]}</p>
            )}
          </button>
        ))}
      </div>

      {/* Instruction Builder - Modern */}
      {selected && selectedIx && (
        <div className="card-static p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">
                Build: <span className="text-primary font-mono">{selected}</span>
              </h3>
              {selectedIx.docs && ensureDocs(selectedIx.docs).length ? (
                <p className="text-sm text-gray-500">{ensureDocs(selectedIx.docs).join(' ')}</p>
              ) : null}
            </div>
          </div>

          {/* Accounts */}
          {selectedIx.accounts.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Accounts
              </h4>
              <div className="space-y-2">
                {selectedIx.accounts.map((acc) => (
                  <div key={acc.name} className="flex items-center gap-3 p-3 bg-surface-elevated rounded-xl">
                    <label className="w-40 text-sm font-mono text-gray-300 flex items-center gap-2 flex-shrink-0">
                      <span className="truncate">{acc.name}</span>
                      {acc.isSigner && (
                        <span className="text-yellow-400 text-xs bg-yellow-400/10 px-1.5 py-0.5 rounded" title="Signer">
                          S
                        </span>
                      )}
                      {acc.isMut && (
                        <span className="text-blue-400 text-xs bg-blue-400/10 px-1.5 py-0.5 rounded" title="Writable">
                          W
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={accountValues[acc.name] || ''}
                      onChange={(e) => setAccountValues({ ...accountValues, [acc.name]: e.target.value })}
                      placeholder={`${acc.isOptional ? '(optional) ' : ''}Public key...`}
                      className="input flex-1 text-sm font-mono"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Args */}
          {selectedIx.args.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                Arguments
              </h4>
              <div className="space-y-3">
                {selectedIx.args.map((arg) => {
                  if (arg.isDefinedType && arg.fields && arg.fields.length > 0) {
                    return (
                      <div key={arg.name} className="border border-white/5 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-primary font-bold">{arg.name}</span>
                          <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded">
                            {arg.definedTypeName || arg.type}
                          </span>
                        </div>
                        {arg.fields.map((field) => {
                          const fieldKey = `${arg.name}.${field.name}`
                          return (
                            <div key={fieldKey} className="flex items-center gap-3 ml-4">
                              <label className="w-32 text-sm font-mono text-gray-400 flex-shrink-0">
                                {field.name}
                                <span className="text-xs text-gray-600 ml-1">({field.type})</span>
                              </label>
                              <input
                                type="text"
                                value={argValues[fieldKey] || ''}
                                onChange={(e) => setArgValues({ ...argValues, [fieldKey]: e.target.value })}
                                placeholder={`${field.type} value...`}
                                className="input flex-1 text-sm font-mono"
                              />
                            </div>
                          )
                        })}
                      </div>
                    )
                  }

                  return (
                    <div key={arg.name} className="flex items-center gap-3 p-3 bg-surface-elevated rounded-xl">
                      <label className="w-40 text-sm font-mono text-gray-300 flex-shrink-0">
                        {arg.name}
                      </label>
                      <input
                        type="text"
                        value={argValues[arg.name] || ''}
                        onChange={(e) => setArgValues({ ...argValues, [arg.name]: e.target.value })}
                        placeholder={`${arg.type} value...`}
                        className="input flex-1 text-sm font-mono"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Fee Payer */}
          <div>
            <h4 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Fee Payer
            </h4>
            <input
              type="text"
              value={feePayer}
              onChange={(e) => setFeePayer(e.target.value)}
              placeholder="Your wallet public key..."
              className="input w-full font-mono text-sm"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={handleBuild}
              disabled={isBuilding}
              className="btn-primary"
            >
              {isBuilding ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Building...
                </span>
              ) : (
                'Build Transaction'
              )}
            </button>
            <button
              onClick={() => {
                const snippet = generateCurlSnippet()
                navigator.clipboard.writeText(snippet)
                showToast('cURL copied to clipboard', 'success')
              }}
              className="btn-secondary"
            >
              Copy cURL
            </button>
          </div>

          {/* Result */}
          {result && (
            <div className="bg-surface-elevated rounded-xl p-4 border border-green-500/20">
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <h4 className="text-sm font-semibold text-green-400">Transaction Built</h4>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(result, null, 2))
                    showToast('Copied to clipboard', 'success')
                  }}
                  className="text-xs text-primary hover:text-secondary transition-colors"
                >
                  Copy JSON
                </button>
              </div>
              <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
