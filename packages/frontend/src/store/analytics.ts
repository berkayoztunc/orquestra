import { create } from 'zustand'
import {
  getPublicStats,
  getAdminAnalytics,
  type PublicStats,
  type AdminAnalytics,
} from '../api/client'

interface AnalyticsState {
  stats: PublicStats | null
  analytics: AdminAnalytics | null
  isLoadingStats: boolean
  isLoadingAnalytics: boolean
  error: string | null

  loadStats: () => Promise<void>
  loadAnalytics: () => Promise<void>
}

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  stats: null,
  analytics: null,
  isLoadingStats: false,
  isLoadingAnalytics: false,
  error: null,

  loadStats: async () => {
    set({ isLoadingStats: true, error: null })
    try {
      const stats = await getPublicStats()
      set({ stats, isLoadingStats: false })
    } catch {
      set({ isLoadingStats: false, error: 'Failed to load stats' })
    }
  },

  loadAnalytics: async () => {
    set({ isLoadingAnalytics: true, error: null })
    try {
      const analytics = await getAdminAnalytics()
      set({ analytics, isLoadingAnalytics: false })
    } catch {
      set({ isLoadingAnalytics: false, error: 'Failed to load analytics' })
    }
  },
}))
