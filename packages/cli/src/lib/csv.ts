/**
 * CSV Writer
 * Streaming CSV writer that appends rows to a file.
 * No external dependencies.
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export class CsvWriter {
  private filePath: string
  private columns: string[]
  private rowCount = 0

  constructor(filePath: string, columns: string[]) {
    this.filePath = filePath
    this.columns = columns

    // Ensure output directory exists
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // Write header
    writeFileSync(filePath, columns.join(',') + '\n', 'utf-8')
  }

  /** Write a single row */
  writeRow(values: Record<string, string | number | boolean | null>): void {
    const row = this.columns.map((col) => escapeCSV(values[col] ?? '')).join(',')
    appendFileSync(this.filePath, row + '\n', 'utf-8')
    this.rowCount++
  }

  /** Write multiple rows */
  writeRows(rows: Array<Record<string, string | number | boolean | null>>): void {
    if (rows.length === 0) return
    const lines = rows
      .map((values) =>
        this.columns.map((col) => escapeCSV(values[col] ?? '')).join(',')
      )
      .join('\n')
    appendFileSync(this.filePath, lines + '\n', 'utf-8')
    this.rowCount += rows.length
  }

  /** Get number of data rows written (excluding header) */
  getRowCount(): number {
    return this.rowCount
  }

  getFilePath(): string {
    return this.filePath
  }
}

/** Escape a value for CSV: quote if it contains comma, quote, or newline */
function escapeCSV(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}
