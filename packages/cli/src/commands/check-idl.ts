/**
 * Command: check-idl
 * Checks each discovered program for an on-chain Anchor IDL account.
 * Reads the program list from a previous scan or a user-provided file,
 * then outputs a CSV with IDL status.
 */

import { RpcClient } from '../lib/rpc'
import { checkIdlStream, type IdlCheckResult } from '../lib/anchor-idl-check'
import { CsvWriter } from '../lib/csv'
import { Checkpoint } from '../lib/checkpoint'
import { resolve } from 'node:path'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { generateDescription, loadAIClientOptions, type AIClientOptions } from '../lib/ai-client'
import { ingestIDL, loadAPIClientOptions, type APIClientOptions } from '../lib/api-client'
import { createHash } from 'node:crypto'

export interface CheckIdlOptions {
  rpcUrl: string
  outDir: string
  /** Path to a JSON file with an array of program IDs. If empty, reads from <outDir>/.program-list.json */
  inputFile: string
  batchSize: number
  concurrency: number
  resume: boolean
  requestsPerSecond: number
  /** Enable AI description generation + Worker DB ingest for each discovered IDL */
  enableIngest: boolean
  /** Skip AI description step (ingest IDL without AI analysis) */
  skipAi: boolean
  /** Max concurrent AI+ingest calls (default: 5) */
  ingestConcurrency: number
}

function sanitizeFilePart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function resolveIdlDisplayName(idlData: Record<string, any>): string | null {
  const topLevelName = typeof idlData.name === 'string' ? idlData.name.trim() : ''
  if (topLevelName) return topLevelName

  const metadataName =
    idlData.metadata && typeof idlData.metadata.name === 'string'
      ? idlData.metadata.name.trim()
      : ''
  if (metadataName) return metadataName

  return null
}

function normalizeIdlForSave(idlData: Record<string, any>, programId: string): Record<string, any> {
  const normalized: Record<string, any> = { ...idlData }
  if (typeof normalized.address !== 'string' || !normalized.address.trim()) {
    normalized.address = programId
  }
  return normalized
}

function readAddressFromIdlFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (typeof parsed.address === 'string' && parsed.address.trim()) {
      return parsed.address.trim()
    }
    return ''
  } catch {
    return null
  }
}

function resolveIdlFileName(
  idlData: Record<string, any>,
  programId: string,
  idlsDir: string,
  usedFileNames: Set<string>
): string {
  const resolvedName = resolveIdlDisplayName(idlData)
  const base = sanitizeFilePart(resolvedName || programId) || programId
  const uniqueSuffix = sanitizeFilePart(programId)

  const candidates = [`${base}.json`, `${base}_${uniqueSuffix}.json`]

  let n = 2
  while (n <= 1000) {
    candidates.push(`${base}_${uniqueSuffix}_${n}.json`)
    n++
  }

  for (const candidate of candidates) {
    if (usedFileNames.has(candidate)) continue

    const candidatePath = resolve(idlsDir, candidate)
    const existingAddress = readAddressFromIdlFile(candidatePath)

    if (!existsSync(candidatePath)) {
      usedFileNames.add(candidate)
      return candidate
    }

    // If file has no address or already belongs to this program, overwrite it.
    if (existingAddress === '' || existingAddress === programId) {
      usedFileNames.add(candidate)
      return candidate
    }
  }

  const fallback = `${base}_${uniqueSuffix}_${Date.now()}.json`
  usedFileNames.add(fallback)
  return fallback
}

/** Compute a short SHA-256 hex hash of canonical IDL JSON for duplicate detection */
function hashIdl(idl: Record<string, any>): string {
  const canonical = JSON.stringify(idl, Object.keys(idl).sort())
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

/** Process AI generation + ingest for a single IDL result. Returns publish outcome. */
async function processIngest(
  r: IdlCheckResult,
  aiOpts: AIClientOptions | null,
  apiOpts: APIClientOptions,
  skipAi: boolean,
): Promise<{ programId: string; uploaded: boolean; aiGenerated: boolean; error: string }> {
  const idl = r.idlData as Record<string, any>
  const idlHash = hashIdl(idl)

  let aiDescription: string | null = null
  let aiAnalysisJson: string | null = null
  let aiModelUsed: string | null = null
  let aiGeneratedAt: string | null = null
  let aiGenerated = false

  if (!skipAi && aiOpts) {
    const result = await generateDescription(idl, r.programId, aiOpts)
    if (result) {
      aiDescription = result.shortDescription
      aiAnalysisJson = result.analysisJson
      aiModelUsed = result.modelUsed
      aiGeneratedAt = result.generatedAt
      aiGenerated = true
    }
  }

  const ingestResult = await ingestIDL(
    {
      programId: r.programId,
      idl,
      idlHash,
      aiDescription,
      aiAnalysisJson,
      aiModelUsed,
      aiGeneratedAt,
    },
    apiOpts,
  )

  if (ingestResult.success) {
    return { programId: r.programId, uploaded: true, aiGenerated, error: '' }
  }
  return { programId: r.programId, uploaded: false, aiGenerated: false, error: ingestResult.error }
}

export async function checkIdl(opts: CheckIdlOptions): Promise<void> {
  const { rpcUrl, outDir, inputFile, batchSize, concurrency, resume, requestsPerSecond, enableIngest, skipAi, ingestConcurrency } = opts

  // Validate ingest config early
  let aiOpts: AIClientOptions | null = null
  let apiOpts: APIClientOptions | null = null

  if (enableIngest) {
    apiOpts = loadAPIClientOptions()
    if (!apiOpts) {
      console.error('Error: --enable-ingest requires ORQUESTRA_API_URL and ORQUESTRA_INGEST_KEY env vars.')
      process.exit(1)
    }
    if (!skipAi) {
      aiOpts = loadAIClientOptions()
      if (!aiOpts) {
        console.warn('Warning: CF_ACCOUNT_ID or CF_API_TOKEN not set — AI descriptions will be skipped.')
      } else {
        console.log(`  AI Model    : ${aiOpts.model}`)
      }
    }
    console.log(`  Ingest URL  : ${apiOpts.baseUrl}`)
    console.log(`  Ingest Con. : ${ingestConcurrency}`)
  }

  console.log('═══════════════════════════════════════════════════')
  console.log('  Anchor On-Chain IDL Checker')
  console.log('═══════════════════════════════════════════════════')
  console.log(`  RPC URL     : ${maskUrl(rpcUrl)}`)
  console.log(`  Output Dir  : ${resolve(outDir)}`)
  console.log(`  Batch Size  : ${batchSize}`)
  console.log(`  Concurrency : ${concurrency}`)
  console.log(`  Rate Limit  : ${requestsPerSecond} req/s`)
  console.log(`  Ingest      : ${enableIngest ? 'enabled' : 'disabled'}`)
  console.log('═══════════════════════════════════════════════════')
  console.log()

  // Load program list
  const listPath = inputFile || resolve(outDir, '.program-list.json')
  if (!existsSync(listPath)) {
    console.error(`Error: Program list not found at ${listPath}`)
    console.error('Run "scan" first, or provide --input-file with a JSON array of program IDs.')
    process.exit(1)
  }

  let allProgramIds: string[]
  try {
    const raw = readFileSync(listPath, 'utf-8')
    allProgramIds = JSON.parse(raw)
    if (!Array.isArray(allProgramIds)) throw new Error('Expected JSON array')
  } catch (err: any) {
    console.error(`Error reading program list: ${err.message}`)
    process.exit(1)
  }

  console.log(`Loaded ${allProgramIds.length} programs from ${listPath}`)

  // Checkpoint for resume
  const checkpointPath = resolve(outDir, '.checkpoint-idl.json')
  const checkpoint = new Checkpoint(checkpointPath, 'check-idl', allProgramIds.length)
  let programIds = allProgramIds

  if (resume && checkpoint.tryResume()) {
    const processedSet = checkpoint.getProcessedSet()
    programIds = allProgramIds.filter((id) => !processedSet.has(id))
    console.log(`Resuming: ${processedSet.size} already processed, ${programIds.length} remaining`)
  }

  // RPC client
  const rpc = new RpcClient({
    url: rpcUrl,
    maxRetries: 5,
    baseDelayMs: 1000,
    requestsPerSecond,
  })

  // CSV writers
  const csvPath = resolve(outDir, 'program_idl_status.csv')
  const csv = new CsvWriter(csvPath, ['program_id', 'has_onchain_idl', 'idl_account', 'error'])

  const publishCsvPath = resolve(outDir, 'program_publish_status.csv')
  const publishCsv = enableIngest
    ? new CsvWriter(publishCsvPath, ['program_id', 'uploaded', 'ai_generated', 'error'])
    : null

  console.log()
  console.log('Checking on-chain IDL for each program...')
  const startTime = Date.now()

  // Create idls directory for saving IDL files
  const idlsDir = resolve(outDir, 'idls')
  if (!existsSync(idlsDir)) {
    mkdirSync(idlsDir, { recursive: true })
  }
  const usedFileNames = new Set<string>()

  let processedCount = 0
  let savedIdlCount = 0
  let ingestedCount = 0
  let aiGeneratedCount = 0
  let ingestErrorCount = 0
  const totalToProcess = programIds.length

  // Semaphore for ingest concurrency control
  let ingestSlots = ingestConcurrency
  const ingestQueue: Array<() => void> = []
  function acquireIngestSlot(): Promise<void> {
    if (ingestSlots > 0) { ingestSlots--; return Promise.resolve() }
    return new Promise((resolve) => ingestQueue.push(() => { ingestSlots--; resolve() }))
  }
  function releaseIngestSlot(): void {
    ingestSlots++
    const next = ingestQueue.shift()
    if (next) next()
  }

  const stats = await checkIdlStream(
    rpc,
    programIds,
    batchSize,
    concurrency,
    async (results: IdlCheckResult[], batchIndex: number) => {
      // Write batch to IDL status CSV
      csv.writeRows(
        results.map((r) => ({
          program_id: r.programId,
          has_onchain_idl: r.hasOnchainIdl ? 'true' : 'false',
          idl_account: r.idlAccount ?? '',
          error: r.error ?? '',
        }))
      )

      // Save IDL files + trigger AI+ingest for programs that have on-chain IDL
      const ingestPromises: Promise<void>[] = []

      for (const r of results) {
        if (r.hasOnchainIdl && r.idlData) {
          const normalizedIdl = normalizeIdlForSave(r.idlData, r.programId)
          const filename = resolveIdlFileName(normalizedIdl, r.programId, idlsDir, usedFileNames)
          const filePath = resolve(idlsDir, filename)
          writeFileSync(filePath, JSON.stringify(normalizedIdl, null, 2), 'utf-8')
          savedIdlCount++

          if (enableIngest && apiOpts) {
            const capturedR = r
            const capturedIdl = normalizedIdl
            const capturedApiOpts = apiOpts
            ingestPromises.push(
              (async () => {
                await acquireIngestSlot()
                try {
                  const outcome = await processIngest(
                    { ...capturedR, idlData: capturedIdl },
                    aiOpts,
                    capturedApiOpts,
                    skipAi,
                  )
                  publishCsv?.writeRows([{
                    program_id: outcome.programId,
                    uploaded: outcome.uploaded ? 'true' : 'false',
                    ai_generated: outcome.aiGenerated ? 'true' : 'false',
                    error: outcome.error,
                  }])
                  if (outcome.uploaded) ingestedCount++
                  if (outcome.aiGenerated) aiGeneratedCount++
                  if (!outcome.uploaded) ingestErrorCount++
                } finally {
                  releaseIngestSlot()
                }
              })()
            )
          }
        }
      }

      await Promise.all(ingestPromises)

      // Update checkpoint
      checkpoint.update(
        results.map((r) => r.programId),
        batchIndex
      )

      processedCount += results.length
      const pct = ((processedCount / totalToProcess) * 100).toFixed(1)
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(0)
      process.stdout.write(
        `\r  Progress: ${processedCount}/${totalToProcess} (${pct}%) — ${elapsedSec}s elapsed`
      )
    }
  )

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log() // newline after progress
  console.log()
  console.log('═══════════════════════════════════════════════════')
  console.log('  Results')
  console.log('═══════════════════════════════════════════════════')
  console.log(`  Total checked : ${stats.total}`)
  console.log(`  With IDL      : ${stats.withIdl}`)
  console.log(`  IDLs saved    : ${savedIdlCount}`)
  console.log(`  Without IDL   : ${stats.withoutIdl}`)
  console.log(`  Errors        : ${stats.errors}`)
  console.log(`  Time          : ${elapsed}s`)
  console.log(`  CSV           : ${csvPath}`)
  console.log(`  IDL files     : ${idlsDir}`)
  if (enableIngest) {
    console.log('───────────────────────────────────────────────────')
    console.log(`  Ingested      : ${ingestedCount}`)
    console.log(`  AI generated  : ${aiGeneratedCount}`)
    console.log(`  Ingest errors : ${ingestErrorCount}`)
    console.log(`  Publish CSV   : ${publishCsvPath}`)
  }
  console.log('═══════════════════════════════════════════════════')

  checkpoint.clear()
  console.log()
  console.log('IDL check complete.')
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.pathname.length > 10) {
      return `${u.protocol}//${u.host}/${u.pathname.slice(1, 8)}...`
    }
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return url.slice(0, 30) + '...'
  }
}
