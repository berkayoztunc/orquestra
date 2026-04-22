import { useState } from 'react'
import { fetchAccountData, type ParsedAccountResponse } from '../api/client'
import { useToast } from './Toast'

interface AccountDataViewerProps {
  projectId: string
}

const NETWORKS = [
  { value: 'mainnet-beta', label: 'Mainnet Beta' },
  { value: 'devnet', label: 'Devnet' },
  { value: 'testnet', label: 'Testnet' },
]

function lamportsToSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(9).replace(/\.?0+$/, '')
}

export default function AccountDataViewer({ projectId }: AccountDataViewerProps): JSX.Element {
  const [address, setAddress] = useState('')
  const [network, setNetwork] = useState('mainnet-beta')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ParsedAccountResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { showToast } = useToast()

  const handleFetch = async () => {
    if (!address.trim()) return
    setLoading(true)
    setResult(null)
    setError(null)

    try {
      const data = await fetchAccountData(projectId, address.trim(), network)
      setResult(data)
    } catch (err: any) {
      const msg =
        err.response?.data?.error ||
        err.response?.data?.details ||
        err.message ||
        'Failed to fetch account'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleFetch()
  }

  return (
    <div className="space-y-6">
      {/* ── Input panel ── */}
      <div className="card-static p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-white mb-1">Fetch Account Data</h3>
          <p className="text-xs text-gray-500">
            Enter a Solana account address to fetch and parse its on-chain data using this
            program's IDL.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Account address (base58)..."
            className="input flex-1 font-mono text-sm"
            spellCheck={false}
          />

          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
            className="input sm:w-40 text-sm"
          >
            {NETWORKS.map((n) => (
              <option key={n.value} value={n.value}>
                {n.label}
              </option>
            ))}
          </select>

          <button
            onClick={handleFetch}
            disabled={loading || !address.trim()}
            className="btn-primary sm:w-32 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Fetching
              </span>
            ) : (
              'Fetch'
            )}
          </button>
        </div>
      </div>

      {/* ── Error state ── */}
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="flex items-start gap-3">
            <svg
              className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <p className="text-sm font-semibold text-red-400">Request failed</p>
              <p className="text-xs text-red-400/80 mt-0.5">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Result ── */}
      {result && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
          {/* Result header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-emerald-500/15">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/25 px-2 py-0.5 rounded-md">
                200 OK
              </span>
              {result.accountType ? (
                <span className="text-xs font-mono font-semibold text-white bg-white/10 px-2 py-0.5 rounded-md border border-white/10">
                  {result.accountType}
                </span>
              ) : (
                <span className="text-xs font-mono text-gray-400 bg-white/5 px-2 py-0.5 rounded-md border border-white/10">
                  Unknown Type
                </span>
              )}
              <span className="text-[11px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-md font-mono">
                {result.cluster}
              </span>
              <span className="text-[11px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-md font-mono">
                slot {result.slot.toLocaleString()}
              </span>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(result.address)
                showToast('Address copied', 'success')
              }}
              className="text-xs text-gray-500 hover:text-primary transition-colors flex-shrink-0"
            >
              Copy address
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* Address */}
            <div>
              <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">Address</p>
              <code className="text-primary font-mono text-sm break-all">{result.address}</code>
            </div>

            {/* Meta row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">Balance</p>
                <span className="text-white font-mono text-sm">
                  {lamportsToSol(result.lamports)} SOL
                </span>
              </div>
              <div>
                <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">
                  Executable
                </p>
                <span className={`text-sm font-mono ${result.executable ? 'text-emerald-400' : 'text-gray-400'}`}>
                  {result.executable ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">
                  Owner Program
                </p>
                <code className="text-gray-300 font-mono text-xs break-all">{result.programId}</code>
              </div>
            </div>

            {/* Parse error warning */}
            {result.parseError && (
              <div className="flex items-center gap-2 text-xs p-2.5 bg-yellow-500/5 rounded-lg border border-yellow-500/15">
                <svg
                  className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-yellow-400">Parse error: {result.parseError}</span>
              </div>
            )}

            {/* Decoded data */}
            {result.data !== null ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] text-gray-500 uppercase tracking-wider">
                    Decoded Fields
                  </p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(result.data, null, 2))
                      showToast('JSON copied', 'success')
                    }}
                    className="text-[11px] text-gray-500 hover:text-primary transition-colors flex items-center gap-1"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                    Copy JSON
                  </button>
                </div>
                <pre className="text-xs font-mono text-gray-300 bg-black/30 rounded-lg p-4 overflow-x-auto leading-relaxed whitespace-pre">
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs p-3 bg-white/3 rounded-lg border border-white/5">
                  <svg
                    className="w-3.5 h-3.5 text-gray-500 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
                    />
                  </svg>
                  <span className="text-gray-400">
                    Unknown account type — no IDL discriminator match. Showing raw data below.
                  </span>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] text-gray-500 uppercase tracking-wider">
                      Raw Data (base64)
                    </p>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(result.raw)
                        showToast('Raw data copied', 'success')
                      }}
                      className="text-[11px] text-gray-500 hover:text-primary transition-colors"
                    >
                      Copy
                    </button>
                  </div>
                  <pre className="text-[10px] font-mono text-gray-500 bg-black/30 rounded-lg p-3 overflow-x-auto break-all whitespace-pre-wrap">
                    {result.raw}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
