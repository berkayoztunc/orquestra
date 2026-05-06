import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircleIcon,
  BotIcon,
  CheckCircle2Icon,
  ClipboardIcon,
  Loader2Icon,
  RefreshCcwIcon,
  SendIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserIcon,
  XCircleIcon,
} from 'lucide-react'
import { runTxAgent } from '@/api/client'
import type { TxAgentResponse, TxAgentState } from '@/api/client'

type ChatRole = 'user' | 'agent'

interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  response?: TxAgentResponse
}

const EXAMPLES = [
  'Find a counter program and build increment by 1 on devnet.',
  'Use project proj_counter, instruction increment, amount 1.',
  'My wallet is 11111111111111111111111111111111.',
]

export default function AgentChat(): JSX.Element {
  const [input, setInput] = useState('')
  const [state, setState] = useState<TxAgentState | undefined>()
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: crypto.randomUUID(),
      role: 'agent',
      text: 'Tell me the Solana action. I will ask for missing fields, build an unsigned transaction, and simulate it.',
    },
  ])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const latestResponse = useMemo(
    () => [...messages].reverse().find((message) => message.response)?.response,
    [messages],
  )
  const unsignedTx = latestResponse?.build?.serializedTransaction

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isSubmitting])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const message = input.trim()
    if (!message || isSubmitting) return

    setInput('')
    setError(null)
    setCopied(false)
    setIsSubmitting(true)
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', text: message },
    ])

    try {
      const response = await runTxAgent({ message, state })
      setState(response.state)
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'agent',
          text: response.message,
          response,
        },
      ])
    } catch (err: any) {
      const nextError = err.toastMessage || err.response?.data?.error || err.message || 'Agent request failed'
      setError(nextError)
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'agent',
          text: 'The agent request failed. Your current chat state is preserved.',
        },
      ])
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetChat = () => {
    setInput('')
    setState(undefined)
    setError(null)
    setCopied(false)
    setMessages([
      {
        id: crypto.randomUUID(),
        role: 'agent',
        text: 'Tell me the Solana action. I will ask for missing fields, build an unsigned transaction, and simulate it.',
      },
    ])
  }

  const copyUnsignedTx = async () => {
    if (!unsignedTx) return
    await navigator.clipboard.writeText(unsignedTx)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-primary">
            <SparklesIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Transaction Agent
          </div>
          <h1 className="text-3xl font-black leading-tight text-white md:text-4xl">
            Build unsigned Solana transactions in chat.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-300">
            The agent keeps the JSON state for you. No wallet connection, no signer, no hosted key custody.
          </p>
        </div>

        <button
          type="button"
          onClick={resetChat}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-gray-200 transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <RefreshCcwIcon className="h-4 w-4" aria-hidden="true" />
          New chat
        </button>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="card-static flex min-h-[620px] flex-col overflow-hidden border border-white/5">
          <div className="border-b border-white/5 px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <BotIcon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">Orquestra tx agent</p>
                  <p className="text-xs text-gray-400">Builds and simulates unsigned transactions</p>
                </div>
              </div>
              <StatusBadge status={latestResponse?.status} />
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5" aria-live="polite">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {isSubmitting && (
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <BotIcon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="max-w-[82%] rounded-2xl rounded-tl-sm border border-white/5 bg-surface-elevated px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-gray-300">
                    <Loader2Icon className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                    Checking IDL, accounts, and simulation...
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {error && (
            <div className="mx-4 mb-3 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200 sm:mx-5">
              <div className="flex items-start gap-2">
                <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">Request failed</p>
                  <p className="mt-1 text-red-100/80">{error}</p>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="border-t border-white/5 p-4 sm:p-5">
            <label htmlFor="agent-message" className="sr-only">
              Message the transaction agent
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <textarea
                id="agent-message"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
                rows={2}
                disabled={isSubmitting}
                placeholder="Describe the transaction, project, wallet public key, accounts, or args..."
                className="input min-h-[52px] flex-1 resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              />
              <button
                type="submit"
                disabled={!input.trim() || isSubmitting}
                className="btn-primary inline-flex min-h-[52px] items-center justify-center gap-2 px-5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <SendIcon className="h-4 w-4" aria-hidden="true" />
                )}
                Send
              </button>
            </div>
          </form>
        </div>

        <aside className="space-y-4">
          <div className="card-static border border-white/5 p-5">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheckIcon className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="text-base font-bold text-white">Run summary</h2>
            </div>
            <StateSummary state={state} response={latestResponse} />
          </div>

          <div className="card-static border border-white/5 p-5">
            <h2 className="text-base font-bold text-white">Quick prompts</h2>
            <div className="mt-3 space-y-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setInput(example)}
                  className="min-h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-xs leading-5 text-gray-300 transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          {unsignedTx && (
            <div className="card-static border border-primary/20 bg-primary/5 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-white">Unsigned transaction</p>
                  <p className="mt-1 text-xs text-gray-300">Base64, simulated, ready for wallet-side signing.</p>
                </div>
                <button
                  type="button"
                  onClick={copyUnsignedTx}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  <ClipboardIcon className="h-4 w-4" aria-hidden="true" />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-4 break-all rounded-xl border border-white/5 bg-surface px-3 py-3 font-mono text-xs leading-5 text-gray-300">
                {shorten(unsignedTx, 180)}
              </p>
            </div>
          )}
        </aside>
      </section>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex items-start gap-3 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BotIcon className="h-4 w-4" aria-hidden="true" />
        </div>
      )}
      <div
        className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 ${
          isUser
            ? 'rounded-tr-sm bg-primary text-dark-900'
            : 'rounded-tl-sm border border-white/5 bg-surface-elevated text-gray-200'
        }`}
      >
        <p className="whitespace-pre-wrap">{message.text}</p>
        {message.response && <ResponseDetails response={message.response} />}
      </div>
      {isUser && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-gray-200">
          <UserIcon className="h-4 w-4" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}

function ResponseDetails({ response }: { response: TxAgentResponse }) {
  if (response.status === 'needs_input') {
    return (
      <div className="mt-3 space-y-2">
        {response.missingFields.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {response.missingFields.map((field) => (
              <span key={`${field.kind}:${field.name}`} className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-gray-300">
                {field.type ? `${field.name}: ${field.type}` : field.name}
              </span>
            ))}
          </div>
        )}
        {response.candidates && response.candidates.length > 0 && (
          <div className="space-y-2">
            {response.candidates.map((candidate) => (
              <div key={candidate.projectId} className="rounded-xl border border-white/5 bg-surface px-3 py-2">
                <p className="text-xs font-bold text-white">{candidate.name}</p>
                <p className="mt-1 font-mono text-[11px] text-gray-400">{candidate.projectId}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (response.status === 'failed') {
    return (
      <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-100">
        {response.simulation?.decodedError
          ? `${response.simulation.decodedError.name}: ${response.simulation.decodedError.msg}`
          : response.error || 'Simulation or build failed.'}
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
      Risk: {response.build?.riskLevel ?? 'unknown'} · Fee: {response.build?.estimatedFee ?? 0} lamports
    </div>
  )
}

function StateSummary({ state, response }: { state?: TxAgentState; response?: TxAgentResponse }) {
  const rows = [
    ['Project', state?.projectId],
    ['Instruction', state?.instruction],
    ['Network', state?.network],
    ['Fee payer', state?.feePayer ? truncateAddress(state.feePayer) : undefined],
  ]

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-400">{label}</span>
            <span className="max-w-[180px] truncate font-mono text-xs text-gray-200">{value || '-'}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-white/5 pt-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-gray-400">Missing</p>
        {response?.missingFields?.length ? (
          <div className="flex flex-wrap gap-2">
            {response.missingFields.map((field) => (
              <span key={`${field.kind}:${field.name}`} className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-gray-300">
                {field.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-300">No active request.</p>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status?: TxAgentResponse['status'] }) {
  if (status === 'simulated') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
        <CheckCircle2Icon className="h-3.5 w-3.5" aria-hidden="true" />
        Simulated
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-400/10 px-3 py-1 text-xs font-semibold text-red-200">
        <XCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
        Failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-gray-300">
      <AlertCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
      Collecting
    </span>
  )
}

function truncateAddress(value: string, chars = 4): string {
  if (value.length <= chars * 2 + 3) return value
  return `${value.slice(0, chars)}...${value.slice(-chars)}`
}

function shorten(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}...`
}
