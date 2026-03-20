import { create } from 'zustand'
import { getMyProjects, listProjects, getProject } from '../api/client'

interface Project {
  id: string
  user_id: string
  name: string
  description: string
  program_id: string
  is_public: boolean
  created_at: string
  updated_at: string
  username?: string
  avatar_url?: string
  latestVersion?: number
  latestVersionDate?: string
  isOwner?: boolean
  socials?: Record<string, string>
}

interface ProjectsState {
  projects: Project[]
  myProjects: Project[]
  selectedProject: Project | null
  isLoading: boolean
  error: string | null
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }

  loadPublicProjects: (params?: { page?: number; search?: string }) => Promise<void>
  loadMyProjects: () => Promise<void>
  loadProject: (projectId: string) => Promise<void>
  clearSelected: () => void
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  myProjects: [],
  selectedProject: null,
  isLoading: false,
  error: null,
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },

  loadPublicProjects: async (params) => {
    set({ isLoading: true, error: null })
    try {
      const data = await listProjects(params)
      set({
        projects: data.projects,
        pagination: data.pagination,
        isLoading: false,
      })
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to load projects' })
    }
  },

  loadMyProjects: async () => {
    set({ isLoading: true, error: null })
    try {
      const projects = await getMyProjects()
      set({ myProjects: projects, isLoading: false })
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to load your projects' })
    }
  },

  loadProject: async (projectId: string) => {
    set({ isLoading: true, error: null })
    try {
      const project = await getProject(projectId)
      set({ selectedProject: project, isLoading: false })
    } catch (err: any) {
      set({ selectedProject: null, isLoading: false, error: err.message || 'Failed to load project' })
    }
  },

  clearSelected: () => set({ selectedProject: null }),
}))
