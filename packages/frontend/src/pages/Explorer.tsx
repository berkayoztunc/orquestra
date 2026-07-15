import { useEffect, useState, useCallback } from 'react'
import { Search, X, ShieldCheck, BookOpen } from 'lucide-react'
import { useProjectsStore } from '../store/projects'
import ProjectCard from '../components/ProjectCard'

const SORT_OPTIONS = [
  { value: 'active', label: 'Most Active' },
  { value: 'recent', label: 'Recently Updated' },
  { value: 'new',    label: 'Newest' },
] as const

type SortValue = typeof SORT_OPTIONS[number]['value']

export default function Explorer(): JSX.Element {
  const { projects, pagination, isLoading, loadPublicProjects } = useProjectsStore()

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortValue>('active')
  const [verified, setVerified] = useState(false)
  const [hasAiDocs, setHasAiDocs] = useState(false)
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null)

  const reload = useCallback(
    (overrides?: { search?: string; sort?: SortValue; verified?: boolean; has_ai_docs?: boolean; page?: number }) => {
      loadPublicProjects({
        page: 1,
        search,
        sort,
        verified,
        has_ai_docs: hasAiDocs,
        ...overrides,
      })
    },
    [search, sort, verified, hasAiDocs, loadPublicProjects],
  )

  // Initial load
  useEffect(() => {
    reload()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (value: string) => {
    setSearch(value)
    if (searchTimeout) clearTimeout(searchTimeout)
    const timeout = setTimeout(() => reload({ search: value, page: 1 }), 300)
    setSearchTimeout(timeout)
  }

  const handleSort = (value: SortValue) => {
    setSort(value)
    reload({ sort: value, page: 1 })
  }

  const handleVerified = () => {
    const next = !verified
    setVerified(next)
    reload({ verified: next, page: 1 })
  }

  const handleAiDocs = () => {
    const next = !hasAiDocs
    setHasAiDocs(next)
    reload({ has_ai_docs: next, page: 1 })
  }

  const handlePage = (page: number) => {
    loadPublicProjects({ page, search, sort, verified, has_ai_docs: hasAiDocs })
  }

  const activeFilters = (verified ? 1 : 0) + (hasAiDocs ? 1 : 0)

  return (
    <div className="space-y-6 px-6 py-10 sm:px-8 sm:py-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-sand-1600">Program Explorer</h1>
        <p className="mt-1 text-sand-1100">
          Browse and search public Solana programs indexed by Orquestra
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <Search className="w-5 h-5 text-sand-1000" aria-hidden="true" />
        </div>
        <input
          type="text"
          placeholder="Search by name, description, or program ID…"
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

      {/* Filters + Sort row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Sort pills */}
        <div className="flex items-center border border-border-low overflow-hidden">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleSort(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                sort === opt.value
                  ? 'bg-sand-1600 text-bg1'
                  : 'text-sand-1100 hover:text-sand-1600 hover:bg-bg2'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <span className="h-5 w-px bg-border-low" />

        {/* Verified toggle */}
        <button
          onClick={handleVerified}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border transition-colors ${
            verified
              ? 'border-green-700 bg-green-950/30 text-green-400'
              : 'border-border-low text-sand-1000 hover:border-border-medium hover:text-sand-1600'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Verified
        </button>

        {/* AI Docs toggle */}
        <button
          onClick={handleAiDocs}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border transition-colors ${
            hasAiDocs
              ? 'border-blue-700 bg-blue-950/30 text-blue-400'
              : 'border-border-low text-sand-1000 hover:border-border-medium hover:text-sand-1600'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          Has AI Docs
        </button>

        {/* Clear filters */}
        {activeFilters > 0 && (
          <button
            onClick={() => {
              setVerified(false)
              setHasAiDocs(false)
              reload({ verified: false, has_ai_docs: false, page: 1 })
            }}
            className="text-xs text-sand-900 hover:text-sand-1200 underline underline-offset-2"
          >
            Clear filters
          </button>
        )}

        {/* Result count */}
        {!isLoading && (
          <span className="ml-auto text-xs text-sand-900 tabular-nums">
            {pagination.total.toLocaleString()} program{pagination.total !== 1 ? 's' : ''}
          </span>
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
          <p className="text-sand-1400 text-lg mb-2">
            {search || activeFilters > 0 ? 'No programs found' : 'No public programs yet'}
          </p>
          <p className="text-sand-1100">
            {search || activeFilters > 0
              ? 'Try adjusting your search or filters'
              : 'Be the first to create a public API!'}
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
                onClick={() => handlePage(pagination.page - 1)}
                className="border border-border-low px-4 py-2 text-sm text-sand-1200 transition-colors hover:border-border-medium hover:text-sand-1600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-sm text-sand-900">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => handlePage(pagination.page + 1)}
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
