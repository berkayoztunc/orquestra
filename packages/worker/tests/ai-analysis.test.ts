import { describe, expect, test } from 'bun:test'
import aiRoutes from '../src/routes/ai'
import { generateAndStoreAIAnalysis } from '../src/services/ai-analysis'
import { generateJWT } from '../src/services/jwt'

const testIDL = {
  version: '0.1.0',
  name: 'counter_program',
  instructions: [
    { name: 'initialize', accounts: [], args: [] },
    { name: 'increment', accounts: [], args: [] },
  ],
  accounts: [{ name: 'Counter', type: { kind: 'struct', fields: [] } }],
  events: [],
  errors: [{ code: 6000, name: 'InvalidCounter', msg: 'Invalid counter' }],
}

function makeDb(projectUserId = 'user_1') {
  const inserted: any[] = []
  const project = {
    id: 'proj_1',
    name: 'Counter Program',
    program_id: 'Counter111111111111111111111111111111111',
    user_id: projectUserId,
    is_public: 1,
  }
  const idlVersion = {
    id: 'idl_v1',
    idl_json: JSON.stringify(testIDL),
    cpi_md: null,
    version: 1,
  }

  return {
    inserted,
    prepare(sql: string) {
      return {
        bind(...params: any[]) {
          return {
            async first() {
              if (sql.includes('FROM projects')) {
                if (sql.includes('user_id = ?') && params[1] !== project.user_id) return null
                return project
              }
              if (sql.includes('FROM idl_versions')) return idlVersion
              return null
            },
            async run() {
              if (sql.includes('INSERT INTO ai_analyses')) {
                inserted.push({
                  id: params[0],
                  project_id: params[1],
                  idl_version_id: params[2],
                  short_description: params[3],
                  detailed_analysis_json: params[4],
                  model_used: params[5],
                  generated_at: params[6],
                  created_at: params[7],
                })
              }
              return { success: true }
            },
          }
        },
      }
    },
  }
}

describe('AI analysis service', () => {
  test('parses JSON model output and stores an analysis row', async () => {
    const db = makeDb()
    const ai = {
      async run() {
        return {
          response: JSON.stringify({
            shortDescription: 'Counter Program manages a simple on-chain counter.',
            summary: 'A basic counter program with initialize and increment flows.',
            tags: ['counter', 'state'],
            instructionCount: 2,
            accountCount: 1,
            errorCount: 1,
            eventCount: 0,
            capabilities: ['initialize counter', 'increment counter'],
            keyInstructions: [{ name: 'increment', purpose: 'Increases the counter value.' }],
            accountsOverview: ['Counter stores the value.'],
            risks: ['Validate signer authority.'],
            integrationNotes: ['Call initialize before increment.'],
          }),
        }
      },
    }

    const result = await generateAndStoreAIAnalysis({
      db,
      ai: ai as any,
      id: 'analysis_1',
      projectId: 'proj_1',
      idlVersionId: 'idl_v1',
      idl: testIDL,
      docsText: '# Counter Program',
      programId: 'Counter111111111111111111111111111111111',
      projectName: 'Counter Program',
      model: '@cf/test/model',
      now: '2026-05-08T00:00:00.000Z',
    })

    expect(result.shortDescription).toContain('Counter Program')
    expect(result.detailedAnalysis.tags).toEqual(['counter', 'state'])
    expect(db.inserted).toHaveLength(1)
    expect(JSON.parse(db.inserted[0].detailed_analysis_json).instructionCount).toBe(2)
  })

  test('stores safe fallback JSON when model output is malformed', async () => {
    const db = makeDb()
    const ai = {
      async run() {
        return { response: 'This is not JSON.' }
      },
    }

    await generateAndStoreAIAnalysis({
      db,
      ai: ai as any,
      id: 'analysis_2',
      projectId: 'proj_1',
      idlVersionId: 'idl_v1',
      idl: testIDL,
      docsText: '# Counter Program',
      programId: 'Counter111111111111111111111111111111111',
      projectName: 'Counter Program',
      model: '@cf/test/model',
      now: '2026-05-08T00:00:00.000Z',
    })

    const detail = JSON.parse(db.inserted[0].detailed_analysis_json)
    expect(detail.summary).toContain('Counter Program')
    expect(detail.instructionCount).toBe(2)
    expect(detail.keyInstructions[0].name).toBe('initialize')
  })
})

describe('AI analysis route', () => {
  test('rejects non-owner regeneration', async () => {
    const token = await generateJWT({ sub: 'user_2', username: 'not-owner' }, 'secret')
    const res = await aiRoutes.request('/projects/proj_1/ai-analysis/regenerate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }, {
      JWT_SECRET: 'secret',
      DB: makeDb('user_1'),
      AI: { async run() { return { response: '{}' } } },
      CACHE: { async put() {} },
      API_BASE_URL: 'https://api.orquestra.dev',
    })

    expect(res.status).toBe(404)
  })

  test('regenerates analysis for project owner', async () => {
    const db = makeDb('user_1')
    const token = await generateJWT({ sub: 'user_1', username: 'owner' }, 'secret')
    const res = await aiRoutes.request('/projects/proj_1/ai-analysis/regenerate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }, {
      JWT_SECRET: 'secret',
      DB: db as any,
      AI: {
        async run() {
          return {
            response: JSON.stringify({
              shortDescription: 'Counter Program manages a simple counter.',
              summary: 'Counter analysis.',
              tags: ['counter'],
              instructionCount: 2,
              accountCount: 1,
              errorCount: 1,
              eventCount: 0,
              capabilities: [],
              keyInstructions: [],
              accountsOverview: [],
              risks: [],
              integrationNotes: [],
            }),
          }
        },
      },
      CACHE: { async put() {} },
      API_BASE_URL: 'https://api.orquestra.dev',
      AI_ANALYSIS_MODEL: '@cf/test/model',
    })

    const body = await res.json() as any
    expect(res.status).toBe(200)
    expect(body.analysis.shortDescription).toContain('Counter Program')
    expect(body.analysis.idlVersion).toBe(1)
    expect(db.inserted).toHaveLength(1)
  })
})
