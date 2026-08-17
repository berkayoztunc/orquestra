import { describe, test, expect } from 'bun:test'
import { getVisibleProject } from '../src/services/project-visibility'

/**
 * The bug this guards against: visibility was enforced on the DB fallback but
 * not on the KV-cache branch that ran first, so a private IDL that had been
 * warmed into the cache was served to anonymous callers.
 */

function makeDb(row: Record<string, unknown> | null) {
  return {
    prepare(_sql: string) {
      return {
        bind() {
          return {
            async first() {
              return row
            },
          }
        },
      }
    },
  }
}

const publicProject = { id: 'p1', program_id: 'Prog111', is_public: 1, user_id: 'owner1' }
const privateProject = { id: 'p2', program_id: 'Prog222', is_public: 0, user_id: 'owner1' }

describe('getVisibleProject', () => {
  test('anonymous caller sees a public project', async () => {
    expect(await getVisibleProject(makeDb(publicProject), 'p1')).toEqual(publicProject)
  })

  test('anonymous caller cannot see a private project', async () => {
    expect(await getVisibleProject(makeDb(privateProject), 'p2')).toBeNull()
  })

  test('a different signed-in user cannot see a private project', async () => {
    expect(await getVisibleProject(makeDb(privateProject), 'p2', 'someone-else')).toBeNull()
  })

  test('the owner can see their own private project', async () => {
    expect(await getVisibleProject(makeDb(privateProject), 'p2', 'owner1')).toEqual(privateProject)
  })

  test('a missing project is null, not an error', async () => {
    expect(await getVisibleProject(makeDb(null), 'nope')).toBeNull()
  })

  test('a null owner on a private project is not matched by an anonymous caller', async () => {
    // Guards the undefined-vs-null comparison: an anonymous caller has
    // userId === undefined, and a system-owned row can have user_id === null.
    const orphaned = { id: 'p3', program_id: 'Prog333', is_public: 0, user_id: null }
    expect(await getVisibleProject(makeDb(orphaned), 'p3')).toBeNull()
  })
})
