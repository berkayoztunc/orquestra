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

interface InstructionItem {
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
}

interface InstructionExplorerProps {
  projectId: string
  instructions: InstructionItem[]
  programId: string
}

function ensureDocs(docs: any): string[] {
  if (Array.isArray(docs)) return docs.filter((d) => typeof d === 'string')
  return []
}

function parseFieldValue(val: string, type: string): any {
  if (type.includes('u') || type.includes('i') || type.includes('f')) return Number(val) || 0
  if (type === 'bool') return val === 'true'
  return val
}

// ── Single accordion card ────────────────────────────────────────────────────
function InstructionCard({
  ix,
  projectId,
}: {
  ix: InstructionItem
  projectId: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [accountValues, setAccountValues] = useState<Record<string, string>>({})
  const [argValues, setArgValues] = useState<Record<string, string>>({})
  const [feePayer, setFeePayer] = useState('')
  const [result, setResult] = useState<any>(null)
  const [isBuilding, setIsBuilding] = useState(false)
  const { showToast } = useToast()

  const apiBase = import.meta.env.VITE_WORKER_URL || 'https://api.orquestra.dev'
  const endpoint = `/api/${projectId}/instructions/${ix.name}/build`
  const shortEndpoint = `/${ix.name}/build`

  const handleBuild = async () => {
    setIsBuilding(true)
    try {
      const parsedArgs: Record<string, any> = {}
      for (const arg of ix.args) {
        if (arg.isDefinedType && arg.fields) {
          const structObj: Record<string, any> = {}
          for (const field of arg.fields) {
            const fieldKey = `${arg.name}.${field.name}`
            structObj[field.name] = parseFieldValue(argValues[fieldKey] || '', field.type)
          }
          parsedArgs[arg.name] = structObj
        } else {
          parsedArgs[arg.name] = parseFieldValue(argValues[arg.name] || '', arg.type)
        }
      }
      const data = await buildTransaction(projectId, ix.name, {
        accounts: accountValues,
        args: parsedArgs,
        feePayer,
      })
      setResult(data)
      showToast('Transaction built successfully', 'success')
    } catch (err: any) {
      showToast(
        err.response?.data?.error || err.response?.data?.details?.join(', ') || 'Build failed',
        'error',
      )
    } finally {
      setIsBuilding(false)
    }
  }

  const generateCurlSnippet = (): string => {
    const parsedArgs: Record<string, any> = {}
    for (const arg of ix.args) {
      if (arg.isDefinedType && arg.fields) {
        const structObj: Record<string, any> = {}
        for (const field of arg.fields) {
          structObj[field.name] = parseFieldValue(argValues[`${arg.name}.${field.name}`] || '', field.type)
        }
        parsedArgs[arg.name] = structObj
      } else {
        parsedArgs[arg.name] = parseFieldValue(argValues[arg.name] || '', arg.type)
      }
    }
    const body = JSON.stringify({ accounts: accountValues, args: parsedArgs, feePayer }, null, 2)
    return `curl -X POST ${apiBase}${endpoint} \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`
  }

  const handleToggle = () => {
    setOpen((v) => !v)
    if (open) {
      setResult(null)
    }
  }

  const docs = ensureDocs(ix.docs)

  return (
    <div className={`rounded-xl transition-all duration-200 overflow-hidden bg-surface-card ${open ? 'ring-1 ring-primary/30 shadow-lg shadow-primary/5' : 'ring-1 ring-white/5 hover:ring-white/10'}`}>
      {/* ── Accordion Header ── */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left bg-surface-card hover:bg-surface-elevated transition-colors"
      >
        {/* POST badge */}
        <span className="flex-shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-mono tracking-wide">
          POST
        </span>

        {/* Endpoint path */}
        <span className="flex-shrink-0 text-xs font-mono text-gray-500 hidden sm:block truncate max-w-[220px]">
          {shortEndpoint}
        </span>

        {/* Instruction name */}
        <span className="font-mono font-semibold text-sm text-white truncate flex-1">
          {ix.name}
        </span>

        {/* Badges: accounts & args */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {ix.accountCount > 0 && (
            <span className="text-[11px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-md font-mono">
              {ix.accountCount} acct
            </span>
          )}
          {ix.argCount > 0 && (
            <span className="text-[11px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-md font-mono">
              {ix.argCount} args
            </span>
          )}
        </div>

        {/* Short doc */}
        {docs[0] && (
          <span className="hidden lg:block text-xs text-gray-500 flex-shrink-0 max-w-[200px] truncate">
            {docs[0]}
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
          {docs.length > 0 && (
            <div className="px-5 py-3 bg-primary/5">
              <p className="text-sm text-gray-400">{docs.join(' ')}</p>
            </div>
          )}

          <div className="flex flex-col lg:flex-row">

            {/* ── LEFT: Parameter Schema ── */}
            <div className="lg:w-[45%] p-5 space-y-5 bg-surface-card border-r border-black/30">
              {/* Endpoint + copy */}
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-black/20">
                <span className="text-[11px] font-bold text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded flex-shrink-0">POST</span>
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

              <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500">Parameters</h4>

              {/* Accounts schema */}
              {ix.accounts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 inline-block" />
                    Accounts
                  </p>
                  <div className="rounded-lg overflow-hidden bg-black/20">
                    {ix.accounts.map((acc) => (
                      <div key={acc.name} className="flex items-center justify-between px-3 py-2.5 border-b border-black/20 last:border-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-sm text-white truncate">{acc.name}</span>
                          {acc.isOptional && (
                            <span className="text-[10px] text-gray-600 bg-white/5 px-1.5 rounded">optional</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-[11px] text-gray-500 font-mono bg-white/5 px-1.5 py-0.5 rounded">pubkey</span>
                          {acc.isSigner && (
                            <span className="text-[11px] font-semibold text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 px-1.5 py-0.5 rounded" title="Signer required">
                              signer
                            </span>
                          )}
                          {acc.isMut && (
                            <span className="text-[11px] font-semibold text-blue-400 bg-blue-400/10 border border-blue-400/20 px-1.5 py-0.5 rounded" title="Writable">
                              mut
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Args schema */}
              {ix.args.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                    Arguments
                  </p>
                  <div className="rounded-lg overflow-hidden bg-black/20">
                    {ix.args.map((arg) => (
                      <div key={arg.name}>
                        <div className="flex items-center justify-between px-3 py-2.5 border-b border-black/20">
                          <span className="font-mono text-sm text-white">{arg.name}</span>
                          <span className="text-[11px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                            {arg.definedTypeName || arg.type}
                          </span>
                        </div>
                        {arg.isDefinedType && arg.fields && arg.fields.length > 0 && (
                          <div className="bg-black/30">
                            {arg.fields.map((field) => (
                              <div key={field.name} className="flex items-center justify-between px-5 py-2 border-b border-black/20 last:border-0">
                                <span className="font-mono text-xs text-gray-400">↳ {field.name}</span>
                                <span className="text-[11px] font-mono text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">
                                  {field.type}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {ix.accounts.length === 0 && ix.args.length === 0 && (
                <p className="text-xs text-gray-600 italic">No parameters required</p>
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

              {/* Account inputs */}
              {ix.accounts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 mb-2">Accounts</p>
                  {ix.accounts.map((acc) => (
                    <div key={acc.name} className="space-y-1">
                      <label className="flex items-center gap-2 text-xs font-mono text-gray-400">
                        {acc.name}
                        {!acc.isOptional && <span className="text-red-400">*</span>}
                        {acc.isSigner && (
                          <span className="text-[10px] text-yellow-400 bg-yellow-400/10 px-1.5 rounded">signer</span>
                        )}
                        {acc.isMut && (
                          <span className="text-[10px] text-blue-400 bg-blue-400/10 px-1.5 rounded">mut</span>
                        )}
                      </label>
                      <input
                        type="text"
                        value={accountValues[acc.name] || ''}
                        onChange={(e) => setAccountValues({ ...accountValues, [acc.name]: e.target.value })}
                        placeholder={`${acc.isOptional ? '(optional) ' : ''}Public key...`}
                        className="input w-full text-sm font-mono"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Arg inputs */}
              {ix.args.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-gray-400 mb-2">Arguments</p>
                  {ix.args.map((arg) => {
                    if (arg.isDefinedType && arg.fields && arg.fields.length > 0) {
                      return (
                        <div key={arg.name} className="rounded-lg overflow-hidden bg-black/20">
                          <div className="px-3 py-2 bg-primary/5 border-b border-black/20">
                            <span className="text-xs font-mono text-primary font-semibold">{arg.name}</span>
                            <span className="text-[11px] text-gray-500 ml-2">({arg.definedTypeName || arg.type})</span>
                          </div>
                          <div className="p-3 space-y-2">
                            {arg.fields.map((field) => {
                              const fieldKey = `${arg.name}.${field.name}`
                              return (
                                <div key={fieldKey} className="space-y-1">
                                  <label className="text-xs font-mono text-gray-500">
                                    {field.name}
                                    <span className="text-gray-600 ml-1">({field.type})</span>
                                  </label>
                                  <input
                                    type="text"
                                    value={argValues[fieldKey] || ''}
                                    onChange={(e) => setArgValues({ ...argValues, [fieldKey]: e.target.value })}
                                    placeholder={`${field.type} value...`}
                                    className="input w-full text-sm font-mono"
                                  />
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    }
                    return (
                      <div key={arg.name} className="space-y-1">
                        <label className="text-xs font-mono text-gray-400">
                          {arg.name}
                          <span className="text-gray-600 ml-1">({arg.type})</span>
                          <span className="text-red-400 ml-0.5">*</span>
                        </label>
                        <input
                          type="text"
                          value={argValues[arg.name] || ''}
                          onChange={(e) => setArgValues({ ...argValues, [arg.name]: e.target.value })}
                          placeholder={`${arg.type} value...`}
                          className="input w-full text-sm font-mono"
                        />
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Fee payer */}
              <div className="space-y-1">
                <label className="text-xs font-mono text-gray-400">
                  feePayer
                  <span className="text-red-400 ml-0.5">*</span>
                </label>
                <input
                  type="text"
                  value={feePayer}
                  onChange={(e) => setFeePayer(e.target.value)}
                  placeholder="Your wallet public key..."
                  className="input w-full text-sm font-mono"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleBuild}
                  disabled={isBuilding}
                  className="btn-primary flex-1"
                >
                  {isBuilding ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Building...
                    </span>
                  ) : (
                    'Execute'
                  )}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generateCurlSnippet())
                    showToast('cURL copied to clipboard', 'success')
                  }}
                  className="btn-secondary px-3"
                  title="Copy cURL"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>

              {/* Result */}
              {result && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-emerald-500/15">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/25 px-2 py-0.5 rounded-md">
                        200 OK
                      </span>
                      <span className="text-xs text-gray-500">Transaction built</span>
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
                  <pre className="p-4 text-xs font-mono text-gray-300 whitespace-pre-wrap max-h-[300px] overflow-y-auto w-150">
                    {JSON.stringify(result, null, 2)}
                  </pre>
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
export default function InstructionExplorer({
  projectId,
  instructions,
}: InstructionExplorerProps): JSX.Element {
  if (instructions.length === 0) {
    return (
      <div className="card-static p-8 text-center">
        <p className="text-gray-400">No instructions defined in this IDL</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {instructions.map((ix) => (
        <InstructionCard key={ix.name} ix={ix} projectId={projectId} />
      ))}
    </div>
  )
}
