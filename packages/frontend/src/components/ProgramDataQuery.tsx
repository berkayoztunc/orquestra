import { useState } from 'react'
import { Copy, Database, Filter, Search } from 'lucide-react'
import {
  queryProgramAccounts,
  type ProgramAccountQueryResponse,
} from '../api/client'
import { useToast } from './Toast'

interface ProgramDataQueryProps {
  projectId: string
  accounts: Array<{ name: string; fields?: Array<{ name: string; type: string }> }>
}

const NETWORKS = [
  { value: 'mainnet-beta', label: 'Mainnet Beta' },
  { value: 'devnet', label: 'Devnet' },
  { value: 'testnet', label: 'Testnet' },
]

function lamportsToSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(9).replace(/\.?0+$/, '')
}

export default function ProgramDataQuery({ projectId, accounts }: ProgramDataQueryProps): JSX.Element {
  const [accountType, setAccountType] = useState(accounts[0]?.name || '')
  const [network, setNetwork] = useState('mainnet-beta')
  const [dataSize, setDataSize] = useState('')
  const [memcmpOffset, setMemcmpOffset] = useState('')
  const [memcmpBytes, setMemcmpBytes] = useState('')
  const [fieldName, setFieldName] = useState('')
  const [fieldBytes, setFieldBytes] = useState('')
  const [limit, setLimit] = useState('25')
  const [includeRaw, setIncludeRaw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ProgramAccountQueryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { showToast } = useToast()

  const selectedAccount = accounts.find((acc) => acc.name === accountType)
  const fields = selectedAccount?.fields || []

  const runQuery = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const payload = {
        accountType: accountType || undefined,
        network,
        dataSize: dataSize ? Number(dataSize) : undefined,
        memcmp: memcmpBytes
          ? [{ offset: memcmpOffset ? Number(memcmpOffset) : 0, bytes: memcmpBytes }]
          : undefined,
        fieldFilters: fieldName && fieldBytes ? [{ field: fieldName, bytes: fieldBytes }] : undefined,
        limit: limit ? Number(limit) : 25,
        includeRaw,
      }
      const data = await queryProgramAccounts(projectId, payload)
      setResult(data)
    } catch (err: any) {
      const msg =
        err.response?.data?.details ||
        err.response?.data?.error ||
        err.message ||
        'Failed to query program accounts'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="card-static p-5 space-y-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
            <Database className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Query Program Accounts</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              Search accounts owned by this program with account type, data size, raw memcmp,
              or fixed IDL field filters. Results are decoded with the IDL when possible.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          <div>
            <label className="mb-2 block text-xs font-medium text-gray-400">Account type</label>
            <select
              value={accountType}
              onChange={(e) => {
                setAccountType(e.target.value)
                setFieldName('')
              }}
              className="input w-full text-sm"
            >
              <option value="">Any IDL type</option>
              {accounts.map((acc) => (
                <option key={acc.name} value={acc.name}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-gray-400">Network</label>
            <select value={network} onChange={(e) => setNetwork(e.target.value)} className="input w-full text-sm">
              {NETWORKS.map((n) => (
                <option key={n.value} value={n.value}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-gray-400">Data size</label>
            <input
              type="number"
              min="1"
              value={dataSize}
              onChange={(e) => setDataSize(e.target.value)}
              placeholder="Auto when fixed"
              className="input w-full text-sm"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-gray-400">Limit</label>
            <input
              type="number"
              min="1"
              max="100"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="input w-full text-sm"
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Filter className="h-4 w-4 text-secondary" />
              <p className="text-sm font-medium text-white">Raw memcmp</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
              <input
                type="number"
                min="0"
                value={memcmpOffset}
                onChange={(e) => setMemcmpOffset(e.target.value)}
                placeholder="Offset"
                className="input text-sm"
              />
              <input
                type="text"
                value={memcmpBytes}
                onChange={(e) => setMemcmpBytes(e.target.value)}
                placeholder="Bytes / pubkey"
                className="input font-mono text-sm"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium text-white">IDL field filter</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <select
                value={fieldName}
                onChange={(e) => setFieldName(e.target.value)}
                disabled={!accountType}
                className="input text-sm disabled:opacity-50"
              >
                <option value="">Field</option>
                {fields.map((field) => (
                  <option key={field.name} value={field.name}>
                    {field.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={fieldBytes}
                onChange={(e) => setFieldBytes(e.target.value)}
                placeholder="Bytes / pubkey"
                disabled={!accountType}
                className="input font-mono text-sm disabled:opacity-50"
                spellCheck={false}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="inline-flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={includeRaw}
              onChange={(e) => setIncludeRaw(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-dark-900 text-primary focus:ring-primary"
            />
            Include raw base64 data
          </label>

          <button
            onClick={runQuery}
            disabled={loading}
            className="btn-primary inline-flex min-h-10 items-center justify-center gap-2 px-5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
            {loading ? 'Querying' : 'Run query'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="card-static p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md border border-emerald-500/25 bg-emerald-500/15 px-2 py-1 font-bold text-emerald-400">
                {result.count} account{result.count === 1 ? '' : 's'}
              </span>
              <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-gray-400">
                {result.cluster}
              </span>
              <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-gray-400">
                slot {result.slot.toLocaleString()}
              </span>
            </div>
            {result.filtersApplied.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {result.filtersApplied.map((filter, index) => (
                  <span key={index} className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-mono text-gray-500">
                    {filter.type === 'dataSize'
                      ? `dataSize=${filter.dataSize}`
                      : `${filter.source}@${filter.offset}`}
                  </span>
                ))}
              </div>
            )}
          </div>

          {result.accounts.length === 0 ? (
            <div className="card-static p-8 text-center text-sm text-gray-500">No matching accounts found.</div>
          ) : (
            result.accounts.map((account) => (
              <div key={account.address} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.025]">
                <div className="flex flex-col gap-3 border-b border-white/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-mono text-primary">
                        {account.accountType || 'Unknown'}
                      </span>
                      <span className="text-xs text-gray-500">{lamportsToSol(account.lamports)} SOL</span>
                    </div>
                    <code className="block truncate font-mono text-sm text-white">{account.address}</code>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(account.address)
                      showToast('Address copied', 'success')
                    }}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-white/10 px-3 text-xs text-gray-400 transition-colors hover:border-primary/30 hover:text-primary"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                </div>

                <div className="space-y-4 p-5">
                  <div className="grid gap-3 text-xs sm:grid-cols-3">
                    <div>
                      <p className="mb-1 uppercase tracking-[0.16em] text-gray-600">Owner</p>
                      <code className="break-all font-mono text-gray-400">{account.owner}</code>
                    </div>
                    <div>
                      <p className="mb-1 uppercase tracking-[0.16em] text-gray-600">Executable</p>
                      <span className="font-mono text-gray-400">{account.executable ? 'Yes' : 'No'}</span>
                    </div>
                    <div>
                      <p className="mb-1 uppercase tracking-[0.16em] text-gray-600">Rent epoch</p>
                      <span className="font-mono text-gray-400">{account.rentEpoch}</span>
                    </div>
                  </div>

                  {account.parseError && (
                    <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-300">
                      Parse error: {account.parseError}
                    </div>
                  )}

                  {account.data ? (
                    <pre className="overflow-x-auto rounded-lg bg-black/30 p-4 font-mono text-xs leading-relaxed text-gray-300">
                      {JSON.stringify(account.data, null, 2)}
                    </pre>
                  ) : account.raw ? (
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/30 p-4 font-mono text-[10px] leading-relaxed text-gray-500">
                      {account.raw}
                    </pre>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
