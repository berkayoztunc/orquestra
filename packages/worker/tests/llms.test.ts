import { describe, expect, test } from 'bun:test'
import llmsApp from '../src/routes/llms'

const testIDL = {
  version: '0.1.0',
  name: 'counter_program',
  instructions: [],
  accounts: [],
  types: [],
  events: [],
  errors: [],
}

function makeEnv(externalApiRows: any[] = []) {
  const projectRow = {
    name: 'Counter Program',
    program_id: 'Counter111111111111111111111111111111111',
    is_public: 1,
    custom_docs: null,
  }

  return {
    API_BASE_URL: 'https://api.orquestra.dev/api',
    CACHE: {
      async get() {
        return null
      },
      async put() {
        return undefined
      },
    },
    DB: {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first() {
                if (sql.includes('FROM projects')) return projectRow
                if (sql.includes('FROM idl_versions')) {
                  return { idl_json: JSON.stringify(testIDL), cpi_md: null }
                }
                return null
              },
              async all() {
                if (sql.includes('FROM known_addresses')) return { results: [] }
                if (sql.includes('FROM custom_api_endpoints')) return { results: externalApiRows }
                return { results: [] }
              },
            }
          },
        }
      },
    },
    IDLS: {},
  }
}

describe('llms.txt external API section', () => {
  test('includes owner-documented external APIs', async () => {
    const res = await llmsApp.request('/project/proj_test/llms.txt', {}, makeEnv([
      {
        name: 'Indexer Account Lookup',
        method: 'GET',
        url: 'https://indexer.example.com/accounts/{address}',
        purpose: 'Fetch indexed account data by public key.',
        parameters_json: JSON.stringify([{ name: 'address', description: 'Account public key', required: true }]),
        example_request: 'curl "https://indexer.example.com/accounts/{address}"',
        response_notes: 'Returns decoded account fields.',
        auth_notes: 'Bearer <API_KEY>',
      },
    ]))

    const text = await res.text()
    expect(res.status).toBe(200)
    expect(text).toContain('## External APIs')
    expect(text).toContain('Orquestra does not execute or proxy them')
    expect(text).toContain('Indexer Account Lookup')
    expect(text).toContain('https://indexer.example.com/accounts/{address}')
    expect(text).toContain('| address | Yes | Account public key |')
  })

  test('omits the section when no external APIs are documented', async () => {
    const res = await llmsApp.request('/project/proj_test/llms.txt', {}, makeEnv())

    const text = await res.text()
    expect(res.status).toBe(200)
    expect(text).not.toContain('## External APIs')
  })
})
