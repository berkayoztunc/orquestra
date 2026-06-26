import { create } from 'zustand'
import { getMyProjects, listProjects, getProject, getProjectByProgramId, listUpdates } from '../api/client'

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
  category?: string | null
}

interface UpdateLog {
  id: string
  project_id: string
  program_id: string
  program_name: string | null
  old_version: number | null
  new_version: number
  old_hash: string | null
  new_hash: string
  detected_at: string
}

interface ProjectsState {
  projects: Project[]
  myProjects: Project[]
  selectedProject: Project | null
  updates: UpdateLog[]
  isLoading: boolean
  error: string | null
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  updatesPagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }

  loadPublicProjects: (params?: { page?: number; search?: string }) => Promise<void>
  loadMyProjects: () => Promise<void>
  loadProject: (projectId: string) => Promise<void>
  loadProjectByProgramId: (programId: string) => Promise<void>
  loadUpdates: (params?: { page?: number; project_id?: string }) => Promise<void>
  clearSelected: () => void
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  myProjects: [],
  selectedProject: null,
  updates: [],
  isLoading: false,
  error: null,
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  updatesPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },

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

  loadProjectByProgramId: async (programId: string) => {
    set({ isLoading: true, error: null })
    try {
      const project = await getProjectByProgramId(programId)
      set({ selectedProject: project, isLoading: false })
    } catch (err: any) {
      set({ selectedProject: null, isLoading: false, error: err.message || 'Failed to load project' })
    }
  },

  loadUpdates: async (params) => {
    set({ isLoading: true, error: null })
    try {
      const data = await listUpdates(params)
      set({
        updates: data.updates,
        updatesPagination: data.pagination,
        isLoading: false,
      })
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to load updates' })
    }
  },

  clearSelected: () => set({ selectedProject: null }),
}))
