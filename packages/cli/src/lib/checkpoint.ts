/**
 * Checkpoint / Resume System
 * Saves progress to a JSON file so long-running scans can be resumed.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface CheckpointData {
  /** Task identifier (e.g., 'scan' or 'check-idl') */
  task: string
  /** Timestamp when checkpoint was created */
  startedAt: string
  /** Timestamp of last update */
  updatedAt: string
  /** Total items to process */
  totalItems: number
  /** Number of items processed so far */
  processedItems: number
  /** Last processed batch index */
  lastBatchIndex: number
  /** List of program IDs already processed (for IDL check resume) */
  processedIds: string[]
  /** Any extra metadata */
  meta: Record<string, any>
}

export class Checkpoint {
  private filePath: string
  private data: CheckpointData

  constructor(filePath: string, task: string, totalItems: number = 0) {
    this.filePath = filePath

    // Ensure directory exists
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    this.data = {
      task,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalItems,
      processedItems: 0,
      lastBatchIndex: -1,
      processedIds: [],
      meta: {},
    }
  }

  /** Try to load an existing checkpoint. Returns true if loaded. */
  tryResume(): boolean {
    if (!existsSync(this.filePath)) return false
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const loaded: CheckpointData = JSON.parse(raw)
      if (loaded.task !== this.data.task) return false
      this.data = loaded
      console.log(
        `[Checkpoint] Resuming: ${this.data.processedItems}/${this.data.totalItems} items processed`
      )
      return true
    } catch {
      return false
    }
  }

  /** Get the set of already-processed IDs for fast lookup */
  getProcessedSet(): Set<string> {
    return new Set(this.data.processedIds)
  }

  /** Update checkpoint after a batch is processed */
  update(newIds: string[], batchIndex: number): void {
    this.data.processedIds.push(...newIds)
    this.data.processedItems += newIds.length
    this.data.lastBatchIndex = batchIndex
    this.data.updatedAt = new Date().toISOString()
    this.save()
  }

  /** Update total items count (often known only after initial scan) */
  setTotalItems(n: number): void {
    this.data.totalItems = n
    this.save()
  }

  /** set arbitrary metadata */
  setMeta(key: string, value: any): void {
    this.data.meta[key] = value
    this.save()
  }

  getMeta(key: string): any {
    return this.data.meta[key]
  }

  getProcessedCount(): number {
    return this.data.processedItems
  }

  getTotalItems(): number {
    return this.data.totalItems
  }

  /** Persist to disk */
  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
  }

  /** Delete checkpoint file (call when task completes) */
  clear(): void {
    if (existsSync(this.filePath)) {
      const { unlinkSync } = require('node:fs')
      unlinkSync(this.filePath)
    }
  }
}
