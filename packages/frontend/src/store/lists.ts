import { create } from 'zustand'
import {
  getLists,
  createList as apiCreateList,
  updateList as apiUpdateList,
  deleteList as apiDeleteList,
  addToList as apiAddToList,
  addToDefaultList as apiAddToDefaultList,
  removeFromList as apiRemoveFromList,
  regenerateScopeKey as apiRegenerateScopeKey,
  type ProgramList,
} from '../api/client'

interface ProgramListsState {
  lists: ProgramList[]
  isLoading: boolean
  error: string | null

  loadLists: () => Promise<void>
  createList: (name: string, description?: string) => Promise<ProgramList>
  updateList: (id: string, data: { name?: string; description?: string }) => Promise<void>
  deleteList: (id: string) => Promise<void>
  addToList: (listId: string, projectId: string) => Promise<void>
  addToDefaultList: (projectId: string) => Promise<void>
  removeFromList: (listId: string, projectId: string) => Promise<void>
  regenerateScopeKey: (listId: string) => Promise<string>
}

export const useProgramListsStore = create<ProgramListsState>((set, get) => ({
  lists: [],
  isLoading: false,
  error: null,

  loadLists: async () => {
    set({ isLoading: true, error: null })
    try {
      const lists = await getLists()
      set({ lists, isLoading: false })
    } catch (err: any) {
      set({ error: err.message ?? 'Failed to load lists', isLoading: false })
    }
  },

  createList: async (name, description) => {
    const list = await apiCreateList(name, description)
    set((s) => ({ lists: [...s.lists, list] }))
    return list
  },

  updateList: async (id, data) => {
    await apiUpdateList(id, data)
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === id
          ? {
              ...l,
              ...(data.name !== undefined ? { name: data.name } : {}),
              ...(data.description !== undefined ? { description: data.description ?? null } : {}),
            }
          : l,
      ),
    }))
  },

  deleteList: async (id) => {
    await apiDeleteList(id)
    set((s) => ({ lists: s.lists.filter((l) => l.id !== id) }))
  },

  addToList: async (listId, projectId) => {
    await apiAddToList(listId, projectId)
    // Bump item_count
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === listId ? { ...l, item_count: l.item_count + 1 } : l,
      ),
    }))
  },

  addToDefaultList: async (projectId) => {
    await apiAddToDefaultList(projectId)
    // Refresh list so new default list (if created) appears with correct count
    await get().loadLists()
  },

  removeFromList: async (listId, projectId) => {
    await apiRemoveFromList(listId, projectId)
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === listId ? { ...l, item_count: Math.max(0, l.item_count - 1) } : l,
      ),
    }))
  },

  regenerateScopeKey: async (listId) => {
    const { scope_key } = await apiRegenerateScopeKey(listId)
    set((s) => ({
      lists: s.lists.map((l) => (l.id === listId ? { ...l, scope_key } : l)),
    }))
    return scope_key
  },
}))
