import { useEffect, useState } from 'react'
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
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">API Explorer</h1>
          <p className="text-gray-400 mt-1">Browse public Solana program APIs</p>
        </div>
        <p className="text-sm text-gray-500">
          {pagination.total} projects available
        </p>
      </div>

      {/* Search Bar - Modern */}
      <div className="relative max-w-2xl">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
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
            className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-500 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        {/* Glow effect */}
        <div className="absolute -inset-1 bg-primary/5 rounded-xl blur-lg -z-10" />
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card-static p-5 space-y-3 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex-shrink-0" />
                <div className="h-5 w-36 rounded-lg bg-white/10" />
              </div>
              <div className="h-3.5 w-full rounded bg-white/10" />
              <div className="h-3.5 w-2/3 rounded bg-white/10" />
              <div className="flex justify-between pt-3 border-t border-white/5">
                <div className="h-3 w-24 rounded bg-white/10" />
                <div className="h-3 w-16 rounded bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="card-static p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 mx-auto mb-4">
            <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-gray-300 text-lg mb-2">
            {search ? 'No projects found' : 'No public projects yet'}
          </p>
          <p className="text-gray-500">
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
            <div className="flex justify-center items-center gap-4 mt-8">
              <button
                disabled={pagination.page <= 1}
                onClick={() => loadPublicProjects({ page: pagination.page - 1, search })}
                className="btn-secondary px-4 py-2 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4 mr-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Previous
              </button>
              <div className="flex items-center gap-2 px-4">
                <span className="text-sm text-gray-400">Page</span>
                <span className="text-white font-medium">{pagination.page}</span>
                <span className="text-sm text-gray-400">of</span>
                <span className="text-white font-medium">{pagination.totalPages}</span>
              </div>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => loadPublicProjects({ page: pagination.page + 1, search })}
                className="btn-secondary px-4 py-2 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next
                <svg className="w-4 h-4 ml-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
