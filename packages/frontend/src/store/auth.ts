import { create } from 'zustand'
import { fetchCurrentUser } from '../api/client'

interface User {
  id: string
  username: string
  email: string
  avatar_url: string
  projectCount?: number
}

interface AuthState {
  user: User | null
  token: string | null
  isLoading: boolean
  isAuthenticated: boolean

  setToken: (token: string) => void
  setUser: (user: User) => void
  loadUser: () => Promise<void>
  logout: () => void
  initialize: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem('token'),
  isLoading: true,
  isAuthenticated: false,

  setToken: (token: string) => {
    localStorage.setItem('token', token)
    set({ token, isAuthenticated: true })
  },

  setUser: (user: User) => {
    localStorage.setItem('user', JSON.stringify(user))
    set({ user, isAuthenticated: true })
  },

  loadUser: async () => {
    try {
      set({ isLoading: true })
      const user = await fetchCurrentUser()
      set({ user, isAuthenticated: true, isLoading: false })
      localStorage.setItem('user', JSON.stringify(user))
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false })
      localStorage.removeItem('token')
      localStorage.removeItem('user')
    }
  },

  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    set({ user: null, token: null, isAuthenticated: false })
  },

  initialize: async () => {
    const token = localStorage.getItem('token')
    if (token) {
      set({ token })
      // Try to load cached user first
      const cachedUser = localStorage.getItem('user')
      if (cachedUser) {
        try {
          set({ user: JSON.parse(cachedUser), isAuthenticated: true })
        } catch {}
      }
      // Then refresh from API
      await get().loadUser()
    } else {
      set({ isLoading: false })
    }
  },
}))
