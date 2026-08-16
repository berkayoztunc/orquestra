import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { useProjectsStore } from '../store/projects'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Updates(): JSX.Element {
  const { updates, updatesPagination, isLoading, loadUpdates } = useProjectsStore()

  useEffect(() => {
    loadUpdates()
  }, [loadUpdates])

  return (
    <div className="space-y-8 px-6 py-10 sm:px-8 sm:py-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-sand-1600">IDL Updates</h1>
        <p className="text-sand-1100 mt-1">
          On-chain IDL changes detected by the daily sync — new versions are indexed automatically
        </p>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card-static p-4 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="h-4 bg-sand-200 w-40" />
                  <div className="h-3 bg-sand-100 w-64" />
                </div>
                <div className="h-4 bg-sand-200 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : updates.length === 0 ? (
        <div className="card-static p-12 text-center">
          <p className="text-sand-1100">No IDL updates detected yet</p>
          <p className="text-sand-900 text-sm mt-1">
            The daily sync will check all indexed programs and log any on-chain changes here
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {updates.map((update) => (
            <div key={update.id} className="card-static p-4 hover:border-border-medium transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden border border-border-low bg-sand-100 text-sand-1400">
                    {update.icon_url ? (
                      <img src={update.icon_url} alt="" className="h-full w-full object-contain p-0.5" />
                    ) : (
                      <FileText className="h-4 w-4" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <Link
                        to={`/project/${update.program_id}`}
                        className="text-sand-1600 font-semibold hover:text-primary transition-colors truncate"
                      >
                        {update.program_name || update.program_id}
                      </Link>
                      <span className="flex items-center gap-1 text-sm shrink-0">
                        <span className="text-sand-1000">
                          {update.old_version !== null ? `v${update.old_version}` : 'new'}
                        </span>
                        <span className="text-sand-900">→</span>
                        <span className="text-primary font-medium">v{update.new_version}</span>
                      </span>
                    </div>
                    <p className="text-sand-1000 text-xs mt-1 font-mono truncate">
                      {update.program_id}
                    </p>
                  </div>
                </div>
                <time className="text-sand-1000 text-sm shrink-0">
                  {formatDate(update.detected_at)}
                </time>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {updatesPagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => loadUpdates({ page: updatesPagination.page - 1 })}
            disabled={updatesPagination.page <= 1}
            className="border border-border-low px-4 py-2 text-sm text-sand-1200 transition-colors hover:border-border-medium hover:text-sand-1600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-sand-900">
            Page {updatesPagination.page} of {updatesPagination.totalPages}
          </span>
          <button
            onClick={() => loadUpdates({ page: updatesPagination.page + 1 })}
            disabled={updatesPagination.page >= updatesPagination.totalPages}
            className="border border-border-low px-4 py-2 text-sm text-sand-1200 transition-colors hover:border-border-medium hover:text-sand-1600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
