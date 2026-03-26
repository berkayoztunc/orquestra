import { Link } from 'react-router-dom'

interface ProjectCardProps {
  project: {
    id: string
    name: string
    description: string
    program_id: string
    is_public: boolean
    created_at: string
    updated_at: string
    username?: string
    avatar_url?: string
  }
  isOwner?: boolean
}

export default function ProjectCard({ project, isOwner }: ProjectCardProps): JSX.Element {
  const updatedDate = new Date(project.updated_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })

  return (
    <Link
      to={`/project/${project.program_id}`}
      className="card block group p-5"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 flex-shrink-0">
            <span className="text-primary font-bold text-sm">
              {project.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <h3 className="font-bold text-lg text-white truncate group-hover:text-primary transition-colors">
            {project.name}
          </h3>
        </div>
        <span
          className={`badge flex-shrink-0 ml-2 ${
            project.is_public
              ? 'badge-primary'
              : 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20'
          }`}
        >
          {project.is_public ? 'Public' : 'Private'}
        </span>
      </div>

      {project.description && (
        <p className="text-gray-400 text-sm mb-4 line-clamp-2 leading-relaxed">{project.description}</p>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-white/5">
        <code className="font-mono truncate max-w-[160px]" title={project.program_id}>
          {project.program_id.slice(0, 6)}...{project.program_id.slice(-4)}
        </code>
        <span className="text-gray-500">{updatedDate}</span>
      </div>

      {!isOwner && project.username && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
          {project.avatar_url && (
            <img src={project.avatar_url} alt="" className="w-4 h-4 rounded-full" />
          )}
          <span className="text-xs text-gray-500">{project.username}</span>
        </div>
      )}
    </Link>
  )
}
