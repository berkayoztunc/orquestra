type ToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (input?: Record<string, unknown>) => Promise<unknown>
}

type RegisterResult = void | (() => void) | { unregister?: () => void }

type ModelContextApi = {
  registerTool?: (tool: ToolDefinition, options?: { signal?: AbortSignal }) => RegisterResult
  provideContext?: (context: { tools: ToolDefinition[] }) => void | Promise<void>
}

function createTools(): ToolDefinition[] {
  const apiBase = import.meta.env.VITE_API_URL || 'https://api.orquestra.dev/api'

  return [
    {
      name: 'search_programs',
      description: 'Search public Solana programs indexed by Orquestra.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or program identifier.' },
        },
        required: ['query'],
      },
      execute: async (input) => {
        const query = String(input?.query || '')
        const response = await fetch(`${apiBase}/projects?search=${encodeURIComponent(query)}&limit=10`)
        if (!response.ok) {
          throw new Error('Failed to search programs')
        }
        const data = await response.json()
        return {
          results: (data.projects || []).map((project: any) => ({
            id: project.id,
            name: project.name,
            programId: project.program_id,
            description: project.description,
            url: `${window.location.origin}/project/${project.program_id}`,
          })),
        }
      },
    },
    {
      name: 'open_program_page',
      description: 'Open a program detail page on Orquestra.',
      inputSchema: {
        type: 'object',
        properties: {
          programId: { type: 'string', description: 'Solana program id.' },
        },
        required: ['programId'],
      },
      execute: async (input) => {
        const programId = String(input?.programId || '')
        const url = `${window.location.origin}/project/${programId}`
        window.location.assign(url)
        return { opened: true, url }
      },
    },
    {
      name: 'open_docs',
      description: 'Open Orquestra documentation pages for API, MCP, CLI, or signing.',
      inputSchema: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            enum: ['api', 'mcp', 'cli', 'sign-and-send'],
          },
        },
        required: ['page'],
      },
      execute: async (input) => {
        const page = String(input?.page || 'api')
        const pathByPage: Record<string, string> = {
          api: '/docs/api',
          mcp: '/docs/mcp',
          cli: '/docs/cli',
          'sign-and-send': '/docs/sign-and-send',
        }
        const path = pathByPage[page] || '/docs/api'
        const url = `${window.location.origin}${path}`
        window.location.assign(url)
        return { opened: true, url }
      },
    },
  ]
}

export function registerWebMcpTools(): () => void {
  const modelContext = (navigator as Navigator & { modelContext?: ModelContextApi }).modelContext

  if (!modelContext) {
    return () => {}
  }

  const tools = createTools()
  const abortController = new AbortController()
  const cleanups: Array<() => void> = []

  if (typeof modelContext.provideContext === 'function') {
    void modelContext.provideContext({ tools })
  }

  if (typeof modelContext.registerTool === 'function') {
    for (const tool of tools) {
      const result = modelContext.registerTool(tool, { signal: abortController.signal })
      if (typeof result === 'function') {
        cleanups.push(result)
      } else if (result && typeof result.unregister === 'function') {
        cleanups.push(() => result.unregister?.())
      }
    }
  }

  return () => {
    abortController.abort()
    for (const cleanup of cleanups) {
      cleanup()
    }
  }
}