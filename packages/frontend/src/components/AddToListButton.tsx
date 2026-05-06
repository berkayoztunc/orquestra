import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../store/auth'
import { useProgramListsStore } from '../store/lists'
import { useToast } from './Toast'

interface AddToListButtonProps {
  projectId: string
}

export default function AddToListButton({ projectId }: AddToListButtonProps): JSX.Element | null {
  const { isAuthenticated } = useAuthStore()
  const { lists, loadLists, addToList, addToDefaultList } = useProgramListsStore()
  const { showToast } = useToast()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isAuthenticated && lists.length === 0) {
      loadLists()
    }
  }, [isAuthenticated, lists.length, loadLists])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  if (!isAuthenticated) return null

  async function handleAdd(listId?: string) {
    setOpen(false)
    setLoading(true)
    try {
      if (listId) {
        await addToList(listId, projectId)
        const list = lists.find((l) => l.id === listId)
        showToast(`Added to "${list?.name ?? 'list'}"`, 'success')
      } else {
        await addToDefaultList(projectId)
        showToast('Added to Default list', 'success')
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Failed to add to list'
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  function handleButtonClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    if (loading) return

    if (lists.length === 0) {
      // No lists yet — auto-add to default list (will be created server-side)
      handleAdd()
      return
    }

    if (lists.length === 1) {
      // Single list — direct add
      handleAdd(lists[0].id)
      return
    }

    // Multiple lists — show picker
    setOpen((prev) => !prev)
  }

  return (
    <div ref={dropdownRef} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={handleButtonClick}
        disabled={loading}
        className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-primary transition-colors border border-white/10 hover:border-primary/40 rounded-lg px-2 py-1 bg-transparent hover:bg-primary/5 disabled:opacity-50"
        title="Add to list"
      >
        {loading ? (
          <div className="w-3.5 h-3.5 rounded-full border border-primary/30 border-t-primary animate-spin" />
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        )}
        {lists.length > 1 ? 'Add to list' : 'Save'}
      </button>

      {open && lists.length > 1 && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-dark-800 border border-white/10 rounded-xl shadow-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-white/5">
            <p className="text-xs text-gray-500 font-medium">Add to list</p>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {lists.map((list) => (
              <button
                key={list.id}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAdd(list.id) }}
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors text-left"
              >
                <span className="truncate">{list.name}</span>
                {list.is_default && (
                  <span className="text-xs text-primary ml-2 shrink-0">Default</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
