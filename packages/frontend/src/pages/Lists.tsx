import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronRight, Copy, List, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { useProgramListsStore } from '../store/lists'
import { getListItems, type ProgramListItem } from '../api/client'
import { useToast } from '../components/Toast'

export default function Lists(): JSX.Element {
  const { isAuthenticated, isLoading: authLoading } = useAuthStore()
  const { lists, isLoading, loadLists, createList, updateList, deleteList, removeFromList, regenerateScopeKey } =
    useProgramListsStore()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [showNewListModal, setShowNewListModal] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [newListDescription, setNewListDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  const [deletingListId, setDeletingListId] = useState<string | null>(null)

  const [expandedListId, setExpandedListId] = useState<string | null>(null)
  const [listItems, setListItems] = useState<Record<string, ProgramListItem[]>>({})
  const [loadingItems, setLoadingItems] = useState<string | null>(null)

  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [confirmRegenerateId, setConfirmRegenerateId] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/')
    }
  }, [isAuthenticated, authLoading, navigate])

  useEffect(() => {
    if (isAuthenticated) {
      loadLists()
    }
  }, [isAuthenticated, loadLists])

  async function handleCreateList() {
    if (!newListName.trim()) return
    setCreating(true)
    try {
      await createList(newListName.trim(), newListDescription.trim() || undefined)
      setShowNewListModal(false)
      setNewListName('')
      setNewListDescription('')
      showToast('List created', 'success')
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? 'Failed to create list', 'error')
    } finally {
      setCreating(false)
    }
  }

  async function handleSaveEdit(id: string) {
    try {
      await updateList(id, { name: editName, description: editDescription || undefined })
      setEditingListId(null)
      showToast('List updated', 'success')
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? 'Failed to update list', 'error')
    }
  }

  async function handleDeleteList(id: string) {
    try {
      await deleteList(id)
      setDeletingListId(null)
      if (expandedListId === id) setExpandedListId(null)
      showToast('List deleted', 'success')
    } catch {
      showToast('Failed to delete list', 'error')
    }
  }

  async function handleExpandList(id: string) {
    if (expandedListId === id) {
      setExpandedListId(null)
      return
    }
    setExpandedListId(id)
    if (!listItems[id]) {
      setLoadingItems(id)
      try {
        const items = await getListItems(id)
        setListItems((prev) => ({ ...prev, [id]: items }))
      } catch {
        showToast('Failed to load list items', 'error')
      } finally {
        setLoadingItems(null)
      }
    }
  }

  async function handleRemoveItem(listId: string, projectId: string) {
    try {
      await removeFromList(listId, projectId)
      setListItems((prev) => ({
        ...prev,
        [listId]: (prev[listId] ?? []).filter((i) => i.project_id !== projectId),
      }))
      showToast('Removed from list', 'success')
    } catch {
      showToast('Failed to remove from list', 'error')
    }
  }

  async function handleCopyScopeKey(listId: string, scopeKey: string) {
    try {
      await navigator.clipboard.writeText(scopeKey)
      setCopiedKeyId(listId)
      setTimeout(() => setCopiedKeyId(null), 2000)
    } catch {
      showToast('Failed to copy scope key', 'error')
    }
  }

  async function handleRegenerateScopeKey(listId: string) {
    setConfirmRegenerateId(null)
    setRegeneratingId(listId)
    try {
      await regenerateScopeKey(listId)
      showToast('Scope key regenerated — old key is now invalid', 'success')
    } catch {
      showToast('Failed to regenerate scope key', 'error')
    } finally {
      setRegeneratingId(null)
    }
  }

  function maskKey(key: string): string {
    if (key.length <= 12) return key
    return `${key.slice(0, 8)}${'*'.repeat(20)}${key.slice(-8)}`
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-8 px-6 py-10 sm:px-8 sm:py-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-sand-1600">My Program Lists</h1>
          <p className="text-sand-1100 mt-1">
            Curate named collections of Solana programs and generate scope keys for focused MCP search.
          </p>
        </div>
        <button onClick={() => setShowNewListModal(true)} className="btn-primary flex items-center gap-2 self-start">
          <Plus className="w-4 h-4" />
          New List
        </button>
      </div>

      {/* Scope key explainer */}
      <div className=" border border-primary/20 bg-primary/5 p-4">
        <p className="text-sm text-sand-1400">
          <span className="font-semibold text-primary">Scope Keys</span> let you restrict MCP{' '}
          <code className="bg-sand-100 px-1 text-xs">search_programs</code> to only the programs in a list.
          Pass the key in the{' '}
          <code className="bg-sand-100 px-1 text-xs">X-Scope-Key</code> header when connecting to
          the MCP server. Without a scope key, all public programs are searchable.
        </p>
      </div>

      {/* List of lists */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-10 h-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        </div>
      ) : lists.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
            <List className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-xl font-semibold text-sand-1600 mb-2">No lists yet</h3>
          <p className="text-sand-1100 mb-6 max-w-sm">
            Create your first list to curate a collection of Solana programs and generate a scope key for it.
          </p>
          <button onClick={() => setShowNewListModal(true)} className="btn-primary">
            Create your first list
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {lists.map((list) => (
            <div key={list.id} className="card overflow-hidden">
              {/* List header row */}
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    {editingListId === list.id ? (
                      <div className="space-y-2">
                        <input
                          className="input w-full text-sand-1600 font-semibold"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit(list.id)}
                          autoFocus
                        />
                        <input
                          className="input w-full text-sm text-sand-1100"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          placeholder="Description (optional)"
                        />
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleSaveEdit(list.id)} className="btn-primary text-sm px-3 py-1">
                            Save
                          </button>
                          <button
                            onClick={() => setEditingListId(null)}
                            className="text-sm text-sand-1100 hover:text-sand-1600 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-sand-1600">{list.name}</h3>
                          {list.is_default && (
                            <span className="badge badge-primary text-xs">Default</span>
                          )}
                        </div>
                        {list.description && (
                          <p className="text-sm text-sand-1100 mt-0.5">{list.description}</p>
                        )}
                        <p className="text-xs text-sand-1100 mt-1">
                          {list.item_count} program{list.item_count !== 1 ? 's' : ''} ·{' '}
                          Created {new Date(list.created_at).toLocaleDateString()}
                        </p>
                      </>
                    )}
                  </div>

                  {editingListId !== list.id && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => {
                          setEditingListId(list.id)
                          setEditName(list.name)
                          setEditDescription(list.description ?? '')
                        }}
                        className="text-sand-1100 hover:text-sand-1600 transition-colors p-1.5 hover:bg-sand-100"
                        title="Rename"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setDeletingListId(list.id)}
                        className="text-sand-1100 hover:text-red-400 transition-colors p-1.5 hover:bg-sand-100"
                        title="Delete list"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Scope key row */}
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-xs text-sand-1100 font-medium shrink-0">Scope Key:</span>
                  <code className="flex-1 text-xs font-mono text-primary bg-primary/5 border border-primary/15 px-3 py-1.5 truncate">
                    {maskKey(list.scope_key)}
                  </code>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleCopyScopeKey(list.id, list.scope_key)}
                      className="flex items-center gap-1.5 text-xs text-sand-1100 hover:text-sand-1600 transition-colors border border-border-low px-2.5 py-1.5 hover:bg-sand-100"
                    >
                      {copiedKeyId === list.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-green-400" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setConfirmRegenerateId(list.id)}
                      disabled={regeneratingId === list.id}
                      className="flex items-center gap-1.5 text-xs text-sand-1100 hover:text-[#b75000] transition-colors border border-border-low px-2.5 py-1.5 hover:bg-sand-100 disabled:opacity-50"
                      title="Regenerate scope key (old key will stop working)"
                    >
                      {regeneratingId === list.id ? (
                        <div className="w-3.5 h-3.5 rounded-full border border-yellow-400/30 border-t-yellow-400 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      Regenerate
                    </button>
                  </div>
                </div>

                {/* Expand / collapse programs */}
                <button
                  onClick={() => handleExpandList(list.id)}
                  className="mt-3 flex items-center gap-1.5 text-xs text-sand-1100 hover:text-primary transition-colors"
                >
                  <ChevronRight
                    className={`w-3.5 h-3.5 transition-transform ${expandedListId === list.id ? 'rotate-90' : ''}`}
                    aria-hidden="true"
                  />
                  {expandedListId === list.id ? 'Hide programs' : 'Show programs'}
                </button>
              </div>

              {/* Expanded programs */}
              {expandedListId === list.id && (
                <div className="border-t border-border-low bg-bg1">
                  {loadingItems === list.id ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="w-6 h-6 rounded-full border border-primary/30 border-t-primary animate-spin" />
                    </div>
                  ) : !listItems[list.id] || listItems[list.id].length === 0 ? (
                    <div className="py-8 text-center text-sm text-sand-1100">
                      No programs in this list yet.{' '}
                      <span className="text-sand-1100">Browse the Explorer and use the + button to add programs.</span>
                    </div>
                  ) : (
                    <div className="divide-y divide-border-low">
                      {listItems[list.id].map((item) => (
                        <div key={item.item_id} className="flex items-center justify-between px-5 py-3 hover:bg-sand-50 transition-colors">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-sand-1600 truncate">{item.name}</p>
                            <code className="text-xs text-sand-1100 font-mono">
                              {item.program_id.slice(0, 8)}…{item.program_id.slice(-4)}
                            </code>
                          </div>
                          <button
                            onClick={() => handleRemoveItem(list.id, item.project_id)}
                            className="ml-4 text-xs text-sand-1100 hover:text-red-400 transition-colors flex items-center gap-1 shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New List Modal */}
      {showNewListModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 space-y-4">
            <h2 className="text-xl font-semibold text-sand-1600">New List</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-sand-1100 mb-1">Name *</label>
                <input
                  className="input w-full"
                  placeholder="e.g. My DeFi Programs"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateList()}
                  autoFocus
                  maxLength={100}
                />
              </div>
              <div>
                <label className="block text-sm text-sand-1100 mb-1">Description</label>
                <input
                  className="input w-full"
                  placeholder="Optional"
                  value={newListDescription}
                  onChange={(e) => setNewListDescription(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => { setShowNewListModal(false); setNewListName(''); setNewListDescription('') }}
                className="text-sm text-sand-1100 hover:text-sand-1600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateList}
                disabled={creating || !newListName.trim()}
                className="btn-primary disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create List'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {deletingListId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-sm p-6 space-y-4">
            <h2 className="text-xl font-semibold text-sand-1600">Delete List?</h2>
            <p className="text-sm text-sand-1100">
              This list and all its programs will be removed. The scope key will stop working. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeletingListId(null)}
                className="text-sm text-sand-1100 hover:text-sand-1600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteList(deletingListId)}
                className="btn-danger"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Regenerate Key Modal */}
      {confirmRegenerateId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-sm p-6 space-y-4">
            <h2 className="text-xl font-semibold text-sand-1600">Regenerate Scope Key?</h2>
            <p className="text-sm text-sand-1100">
              The current scope key will immediately stop working. Any MCP clients using it will need to be updated
              with the new key.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmRegenerateId(null)}
                className="text-sm text-sand-1100 hover:text-sand-1600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRegenerateScopeKey(confirmRegenerateId)}
                className="bg-yellow-500 hover:bg-yellow-400 text-black font-medium text-sm px-4 py-2 transition-colors"
              >
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
