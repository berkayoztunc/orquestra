import { Link } from 'react-router-dom'
import { BadgeCheck, CalendarDays, CheckCircle2, Code2, Layers, LockKeyhole, UserRound } from 'lucide-react'
import AddToListButton from './AddToListButton'

const CATEGORY_LABELS: Record<string, string> = {
  'dex-amm': 'DEX / AMM',
  'lending': 'Lending',
  'staking': 'Staking',
  'nft-marketplace': 'NFT Market',
  'token-launch': 'Token Launch',
  'gaming': 'Gaming',
  'payments': 'Payments',
  'governance': 'Governance',
  'perpetuals': 'Perpetuals',
  'derivatives': 'Derivatives',
  'infrastructure': 'Infrastructure',
  'social': 'Social',
}

interface ProjectCardProps {
  project: {
    id: string
    name: string
    description: string
    program_id: string
    is_public?: boolean | number
    isPublic?: boolean | number
    created_at?: string
    updated_at?: string
    username?: string
    avatar_url?: string
    category?: string | null
    /** Verified program logo (Helius Wallet Identity API) — preferred over avatar_url when present. */
    icon_url?: string | null
    category_source?: string | null
  }
  isOwner?: boolean
}

export default function ProjectCard({ project, isOwner }: ProjectCardProps): JSX.Element {
  const rawVisibility = project.is_public ?? project.isPublic
  const isPublic = rawVisibility === undefined ? true : rawVisibility === true || rawVisibility === 1
  const updatedAt = project.updated_at ? new Date(project.updated_at) : null
  const updatedDate = updatedAt && !Number.isNaN(updatedAt.getTime())
    ? updatedAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
    : 'Recently'
  const categoryLabel = project.category && project.category !== 'other'
    ? CATEGORY_LABELS[project.category]
    : null
  const isVerifiedIdentity = project.category_source === 'helius'

  return (
    <Link
      to={`/project/${project.program_id}`}
      className="group relative flex min-h-[260px] flex-col overflow-hidden border border-border-low bg-bg1 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-border-medium hover:bg-sand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400"
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden border border-border-low bg-sand-100 text-sm font-semibold text-sand-1500">
            {project.icon_url ? (
              <img src={project.icon_url} alt="" className="h-full w-full object-contain p-1" />
            ) : project.avatar_url ? (
              <img src={project.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              project.name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 truncate text-lg font-semibold text-sand-1600 transition-colors group-hover:text-sand-1600">
              <span className="truncate">{project.name}</span>
              {isVerifiedIdentity && (
                <BadgeCheck className="h-4 w-4 shrink-0 text-blue-500" aria-label="Verified program" />
              )}
            </h3>
            {!isOwner && project.username && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-sand-1100">
                <UserRound className="h-3.5 w-3.5" />
                <span className="truncate">{project.username}</span>
              </div>
            )}
          </div>
        </div>

        <span onClick={(e) => { e.preventDefault(); e.stopPropagation() }} className="shrink-0">
          <AddToListButton projectId={project.id} />
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-medium ${
            isPublic
              ? 'border-border-low bg-sand-100 text-sand-1500'
              : 'border-[#b75000]/20 bg-[#b75000]/10 text-[#b75000]'
          }`}
        >
          {isPublic ? <CheckCircle2 className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}
          {isPublic ? 'Public' : 'Private'}
        </span>

        {categoryLabel && (
          <span className="inline-flex items-center gap-1.5 border border-border-low bg-sand-100 px-2.5 py-1 text-xs font-medium text-sand-1200">
            <Layers className="h-3.5 w-3.5" />
            {categoryLabel}
          </span>
        )}
      </div>

      {project.description ? (
        <p className="mb-5 line-clamp-3 text-sm leading-6 text-sand-1200">{project.description}</p>
      ) : (
        <p className="mb-5 line-clamp-3 text-sm leading-6 text-sand-1100">No description provided.</p>
      )}

      <div className="mt-auto space-y-3 border-t border-border-low pt-4">
        <div className="flex min-w-0 items-center gap-2 bg-sand-100 px-3 py-2">
          <Code2 className="h-3.5 w-3.5 shrink-0 text-sand-1100" />
          <code className="min-w-0 truncate font-mono text-xs text-sand-1500" title={project.program_id}>
            {project.program_id}
          </code>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-sand-1100">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-sand-1100" />
            <span className="truncate">Updated {updatedDate}</span>
          </span>
          <span className="text-sand-1100 transition-colors group-hover:text-sand-1600">Open</span>
        </div>
      </div>
    </Link>
  )
}
