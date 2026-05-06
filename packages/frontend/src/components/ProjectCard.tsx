import { Link } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Code2, Layers, LockKeyhole, UserRound } from 'lucide-react'
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

  return (
    <Link
      to={`/project/${project.program_id}`}
      className="group relative flex min-h-[260px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] p-5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/25 hover:bg-white/[0.04] hover:shadow-[0_18px_50px_rgba(0,0,0,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-primary/20 bg-primary/10 text-sm font-semibold text-primary">
            {project.avatar_url ? (
              <img src={project.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              project.name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-white transition-colors group-hover:text-primary">
              {project.name}
            </h3>
            {!isOwner && project.username && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
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
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
            isPublic
              ? 'border-primary/20 bg-primary/10 text-primary'
              : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-300'
          }`}
        >
          {isPublic ? <CheckCircle2 className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}
          {isPublic ? 'Public' : 'Private'}
        </span>

        {categoryLabel && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-secondary/20 bg-secondary/10 px-2.5 py-1 text-xs font-medium text-secondary">
            <Layers className="h-3.5 w-3.5" />
            {categoryLabel}
          </span>
        )}
      </div>

      {project.description ? (
        <p className="mb-5 line-clamp-3 text-sm leading-6 text-gray-400">{project.description}</p>
      ) : (
        <p className="mb-5 line-clamp-3 text-sm leading-6 text-gray-500">No description provided.</p>
      )}

      <div className="mt-auto space-y-3 border-t border-white/5 pt-4">
        <div className="flex min-w-0 items-center gap-2 rounded-lg bg-dark-950/40 px-3 py-2">
          <Code2 className="h-3.5 w-3.5 shrink-0 text-gray-600" />
          <code className="min-w-0 truncate font-mono text-xs text-gray-300" title={project.program_id}>
            {project.program_id}
          </code>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-gray-600" />
            <span className="truncate">Updated {updatedDate}</span>
          </span>
          <span className="text-gray-600 transition-colors group-hover:text-primary">Open</span>
        </div>
      </div>
    </Link>
  )
}
