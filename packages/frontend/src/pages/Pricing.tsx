import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckIcon,
  ZapIcon,
  BotIcon,
  KeyIcon,
  GlobeIcon,
  ShieldCheckIcon,
  ServerIcon,
} from 'lucide-react'
import { getGitHubLoginUrl } from '../api/client'
import { useAuthStore } from '../store/auth'

type Billing = 'monthly' | 'quarterly'

export default function Pricing(): JSX.Element {
  const { isAuthenticated } = useAuthStore()
  const [billing, setBilling] = useState<Billing>('monthly')

  const isQuarterly = billing === 'quarterly'
  const proPrice = isQuarterly ? '49' : '19'
  const proUnit = isQuarterly ? '/ quarter' : '/ month'
  const proSub = isQuarterly
    ? 'billed $49 every 3 months'
    : 'or $49 / quarter — save 14%'

  return (
    <div className="pb-20">
      <section className="pt-14">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-8 md:mb-10">
            <h1 className="text-3xl md:text-5xl font-bold leading-tight mb-3">
              <span className="text-white">Pick a plan in </span>
              <span className="gradient-text">10 seconds</span>
            </h1>
            <p className="text-sm md:text-base text-gray-400 max-w-2xl mx-auto">
              Free for building in public. Pro for private projects and MCP write actions.
            </p>
          </div>

          <div className="flex justify-center mb-6 md:mb-8">
            <div
              role="group"
              aria-label="Billing period"
              className="inline-flex items-center gap-1 rounded-xl p-1 bg-surface-elevated"
            >
              <button
                type="button"
                onClick={() => setBilling('monthly')}
                className={`min-h-10 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface-elevated ${
                  billing === 'monthly'
                    ? 'bg-surface-card text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBilling('quarterly')}
                className={`min-h-10 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface-elevated ${
                  billing === 'quarterly'
                    ? 'bg-surface-card text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Quarterly
                <span className="ml-2 inline-flex items-center rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary leading-none">
                  Save 14%
                </span>
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <article className="card p-6 md:p-7 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-semibold tracking-[0.16em] text-gray-500 uppercase">Free</p>
                <span className="text-xs text-primary bg-primary/10 rounded-full px-2 py-1">Most users start here</span>
              </div>

              <div className="mb-5">
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-bold text-white font-mono tabular-nums">$0</span>
                  <span className="text-gray-500 text-sm mb-1">forever</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">No card required</p>
              </div>

              <ul className="space-y-2.5 mb-6 flex-1">
                {[
                  { icon: <GlobeIcon className="w-4 h-4" />, text: 'Unlimited public projects' },
                  { icon: <ZapIcon className="w-4 h-4" />, text: 'All REST API endpoints' },
                  { icon: <BotIcon className="w-4 h-4" />, text: 'MCP read tools' },
                  { icon: <CheckIcon className="w-4 h-4" />, text: 'Transaction builder + PDA derivation' },
                ].map((item) => (
                  <li key={item.text} className="flex items-center gap-2.5 text-sm text-gray-300">
                    <span className="text-primary flex-shrink-0" aria-hidden="true">{item.icon}</span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>

              {isAuthenticated ? (
                <Link to="/dashboard" className="btn-secondary text-sm py-3 text-center block">
                  Continue with Free
                </Link>
              ) : (
                <a href={getGitHubLoginUrl()} className="btn-secondary text-sm py-3 text-center block">
                  Start Free
                </a>
              )}
            </article>

            <article className="card p-6 md:p-7 flex flex-col border border-primary/25 shadow-[0_0_36px_rgba(0,217,255,0.12)]">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-semibold tracking-[0.16em] text-gray-500 uppercase">Pro</p>
                <span className="text-xs text-secondary bg-secondary/10 rounded-full px-2 py-1">For production teams</span>
              </div>

              <div className="mb-5">
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-bold text-white font-mono tabular-nums">${proPrice}</span>
                  <span className="text-gray-500 text-sm mb-1">{proUnit}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{proSub}</p>
              </div>

              <ul className="space-y-2.5 mb-6 flex-1">
                {[
                  { icon: <CheckIcon className="w-4 h-4" />, text: 'Everything in Free' },
                  { icon: <ShieldCheckIcon className="w-4 h-4" />, text: 'Private projects' },
                  { icon: <BotIcon className="w-4 h-4" />, text: 'MCP write: build_instruction' },
                  { icon: <KeyIcon className="w-4 h-4" />, text: 'API key management + higher limits' },
                ].map((item) => (
                  <li key={item.text} className="flex items-center gap-2.5 text-sm text-gray-200">
                    <span className="text-secondary flex-shrink-0" aria-hidden="true">{item.icon}</span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>

              <a
                href="mailto:hello@orquestra.dev?subject=Orquestra Pro"
                className="btn-primary text-sm py-3 text-center block"
              >
                Get Pro Access
              </a>
            </article>
          </div>

          <div className="mt-4 card-static p-4 md:p-5 overflow-x-auto">
            <p className="text-xs uppercase tracking-[0.14em] text-gray-500 mb-3">Plan differences</p>
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left py-2 pr-3 text-xs font-medium uppercase tracking-[0.12em] text-gray-500">Feature</th>
                  <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-[0.12em] text-gray-400">Free</th>
                  <th className="text-left py-2 pl-3 text-xs font-medium uppercase tracking-[0.12em] text-secondary">Pro</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    feature: 'Project visibility',
                    free: 'Public only',
                    pro: 'Public + Private',
                  },
                  {
                    feature: 'MCP access',
                    free: 'Read tools',
                    pro: 'Read + build_instruction',
                  },
                  {
                    feature: 'API keys',
                    free: 'Not available',
                    pro: 'Create + rotate keys',
                  },
                  {
                    feature: 'Limits & support',
                    free: 'Standard',
                    pro: 'Higher + priority',
                  },
                ].map((row) => (
                  <tr key={row.feature} className="border-b border-white/5 last:border-0">
                    <td className="py-2.5 pr-3 text-gray-300">{row.feature}</td>
                    <td className="py-2.5 px-3 text-gray-400">{row.free}</td>
                    <td className="py-2.5 pl-3 text-gray-200">{row.pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 card-static p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1">
              <p className="text-xs uppercase tracking-[0.14em] text-gray-500 mb-2">Self-hosted option</p>
              <div className="flex items-center gap-2 mb-1.5">
                <ServerIcon className="w-4 h-4 text-primary" aria-hidden="true" />
                <p className="text-white text-sm font-medium">Run Orquestra on your own Cloudflare account</p>
              </div>
              <p className="text-xs md:text-sm text-gray-400">
                Full MIT open source stack, full control, no hosted plan limits.
              </p>
            </div>
            <a
              href="https://github.com/berkayoztunc/orquestra"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-sm px-5 py-2.5 text-center min-h-10"
            >
              View GitHub
            </a>
          </div>

          <div className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2">
            {['No credit card for Free', 'MIT open source', 'Cancel anytime'].map((item) => (
              <span key={item} className="flex items-center gap-1.5 text-xs text-gray-600">
                <CheckIcon className="w-3 h-3 text-primary/50" aria-hidden="true" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
