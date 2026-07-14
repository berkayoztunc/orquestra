import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useProjectsStore } from '../store/projects'
import ProjectCard from '../components/ProjectCard'

export default function Explorer(): JSX.Element {
  const { projects, pagination, isLoading, loadPublicProjects } = useProjectsStore()
  const [search, setSearch] = useState('')
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    loadPublicProjects()
  }, [loadPublicProjects])

  const handleSearch = (value: string) => {
    setSearch(value)
    if (searchTimeout) clearTimeout(searchTimeout)
    const timeout = setTimeout(() => {
      loadPublicProjects({ search: value, page: 1 })
    }, 300)
    setSearchTimeout(timeout)
  }

  return (
    <div className="space-y-8 px-6 py-10 sm:px-8 sm:py-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-sand-1600">Program Explorer</h1>
          <p className="text-sand-1100 mt-1">Browse and search public Solana programs indexed by Orquestra</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <Search className="w-5 h-5 text-sand-1000" aria-hidden="true" />
        </div>
        <input
          type="text"
          placeholder="Search by name, description, or program ID..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="input w-full pl-12 pr-12 py-4"
        />
        {search && (
          <button
            onClick={() => handleSearch('')}
            className="absolute inset-y-0 right-0 pr-4 flex items-center text-sand-1000 hover:text-sand-1600 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card-static p-5 space-y-3 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-sand-200 flex-shrink-0" />
                <div className="h-5 w-36 bg-sand-200" />
              </div>
              <div className="h-3.5 w-full bg-sand-200" />
              <div className="h-3.5 w-2/3 bg-sand-200" />
              <div className="flex justify-between pt-3 border-t border-border-low">
                <div className="h-3 w-24 bg-sand-200" />
                <div className="h-3 w-16 bg-sand-200" />
              </div>
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="card-static p-12 text-center">
          <div className="w-16 h-16 bg-primary/10 flex items-center justify-center border border-primary/20 mx-auto mb-4">
            <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sand-1400 text-lg mb-2">
            {search ? 'No projects found' : 'No public projects yet'}
          </p>
          <p className="text-sand-1100">
            {search ? 'Try a different search term' : 'Be the first to create a public API!'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-4">
              <button
                disabled={pagination.page <= 1}
                onClick={() => loadPublicProjects({ page: pagination.page - 1, search })}
                className="border border-border-low px-4 py-2 text-sm text-sand-1200 transition-colors hover:border-border-medium hover:text-sand-1600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-sm text-sand-900">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => loadPublicProjects({ page: pagination.page + 1, search })}
                className="border border-border-low px-4 py-2 text-sm text-sand-1200 transition-colors hover:border-border-medium hover:text-sand-1600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
