import { describe, test, expect } from 'bun:test'
import {
  validateProjectInput,
  validateIDLUpload,
  validateBuildRequest,
  validateAPIKeyRequest,
  isNonEmptyString,
  isNumber,
  isBoolean,
  isObject,
  isArray,
} from '../src/services/validation'

describe('Primitive validators', () => {
  test('isNonEmptyString', () => {
    expect(isNonEmptyString('hello')).toBe(true)
    expect(isNonEmptyString('')).toBe(false)
    expect(isNonEmptyString('  ')).toBe(false)
    expect(isNonEmptyString(42)).toBe(false)
    expect(isNonEmptyString(null)).toBe(false)
  })

  test('isNumber', () => {
    expect(isNumber(42)).toBe(true)
    expect(isNumber(0)).toBe(true)
    expect(isNumber(NaN)).toBe(false)
    expect(isNumber('42')).toBe(false)
  })

  test('isBoolean', () => {
    expect(isBoolean(true)).toBe(true)
    expect(isBoolean(false)).toBe(true)
    expect(isBoolean(1)).toBe(false)
    expect(isBoolean('true')).toBe(false)
  })

  test('isObject', () => {
    expect(isObject({})).toBe(true)
    expect(isObject({ a: 1 })).toBe(true)
    expect(isObject(null)).toBe(false)
    expect(isObject([])).toBe(false)
    expect(isObject('string')).toBe(false)
  })

  test('isArray', () => {
    expect(isArray([])).toBe(true)
    expect(isArray([1, 2])).toBe(true)
    expect(isArray({})).toBe(false)
    expect(isArray('arr')).toBe(false)
  })
})

describe('validateProjectInput', () => {
  test('validates correct input', () => {
    const result = validateProjectInput({ name: 'my-project', description: 'A project' })
    expect(result.success).toBe(true)
    expect(result.data?.name).toBe('my-project')
  })

  test('rejects missing name', () => {
    const result = validateProjectInput({ description: 'No name' })
    expect(result.success).toBe(false)
    expect(result.errors?.some(e => e.field === 'name')).toBe(true)
  })

  test('rejects invalid name chars', () => {
    const result = validateProjectInput({ name: 'my project!' })
    expect(result.success).toBe(false)
    expect(result.errors?.some(e => e.field === 'name')).toBe(true)
  })

  test('rejects name over 100 chars', () => {
    const result = validateProjectInput({ name: 'a'.repeat(101) })
    expect(result.success).toBe(false)
  })

  test('rejects invalid cluster', () => {
    const result = validateProjectInput({ name: 'test', cluster: 'invalid-net' })
    expect(result.success).toBe(false)
    expect(result.errors?.some(e => e.field === 'cluster')).toBe(true)
  })

  test('accepts valid cluster', () => {
    const result = validateProjectInput({ name: 'test', cluster: 'devnet' })
    expect(result.success).toBe(true)
  })

  test('rejects non-object body', () => {
    const result = validateProjectInput('not an object')
    expect(result.success).toBe(false)
  })
})

describe('validateIDLUpload', () => {
  test('validates correct IDL upload', () => {
    const result = validateIDLUpload({
      idl: { name: 'prog', version: '0.1.0', instructions: [{ name: 'init' }] },
    })
    expect(result.success).toBe(true)
  })

  test('rejects missing IDL', () => {
    const result = validateIDLUpload({})
    expect(result.success).toBe(false)
    expect(result.errors?.some(e => e.field === 'idl')).toBe(true)
  })

  test('rejects IDL without name', () => {
    const result = validateIDLUpload({
      idl: { version: '0.1.0', instructions: [] },
    })
    expect(result.success).toBe(false)
    expect(result.errors?.some(e => e.field === 'idl.name')).toBe(true)
  })
})

describe('validateBuildRequest', () => {
  test('validates correct build request', () => {
    const result = validateBuildRequest({
      payer: '11111111111111111111111111111111',
      accounts: { authority: '11111111111111111111111111111111' },
      args: { amount: 1000 },
    })
    expect(result.success).toBe(true)
  })

  test('rejects missing payer', () => {
    const result = validateBuildRequest({ accounts: {}, args: {} })
    expect(result.success).toBe(false)
    expect(result.errors?.some(e => e.field === 'payer')).toBe(true)
  })

  test('rejects invalid base58 key', () => {
    const result = validateBuildRequest({
      payer: 'not-a-valid-key!',
      accounts: {},
      args: {},
    })
    expect(result.success).toBe(false)
    expect(result.errors?.some(e => e.field === 'payer')).toBe(true)
  })

  test('rejects invalid account keys', () => {
    const result = validateBuildRequest({
      payer: '11111111111111111111111111111111',
      accounts: { bad: 'invalid!!!' },
    })
    expect(result.success).toBe(false)
    expect(result.errors?.some(e => e.field === 'accounts.bad')).toBe(true)
  })
})

describe('validateAPIKeyRequest', () => {
  test('accepts empty body', () => {
    const result = validateAPIKeyRequest('not-object')
    expect(result.success).toBe(true)
    expect(result.data).toEqual({})
  })

  test('validates expiresInDays', () => {
    const result = validateAPIKeyRequest({ expiresInDays: 30 })
    expect(result.success).toBe(true)
    expect(result.data?.expiresInDays).toBe(30)
  })

  test('rejects expiresInDays over 365', () => {
    const result = validateAPIKeyRequest({ expiresInDays: 500 })
    expect(result.success).toBe(false)
  })

  test('rejects non-numeric expiresInDays', () => {
    const result = validateAPIKeyRequest({ expiresInDays: 'thirty' })
    expect(result.success).toBe(false)
  })
})
