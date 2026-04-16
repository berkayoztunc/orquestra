/**
 * Auto-detect known Solana programs and seed their categories
 * Runs automatically when IDLs are imported/created
 * No manual seeding needed!
 */

import type { D1Database } from '@cloudflare/workers-types'

export interface KnownProgram {
  name: string
  aliases: string[]
  category: string
  tags: string[]
}

/**
 * Known Solana programs with categories and aliases
 * Used for auto-detection when projects are created
 */
export const KNOWN_PROGRAMS: Record<string, KnownProgram> = {
  pumpfun: {
    name: 'Pump.fun',
    aliases: ['pump', 'pump.fun', 'pumpfun', 'pump fun'],
    category: 'token-launch',
    tags: ['token', 'launch', 'bonding-curve', 'meme'],
  },
  'magic-eden': {
    name: 'Magic Eden',
    aliases: ['magiceden', 'magic eden', 'me', 'magic-eden'],
    category: 'nft-marketplace',
    tags: ['nft', 'marketplace', 'trading', 'collection'],
  },
  raydium: {
    name: 'Raydium',
    aliases: ['ray', 'raydium', 'ray dium'],
    category: 'dex-amm',
    tags: ['dex', 'amm', 'swap', 'liquidity', 'pool'],
  },
  orca: {
    name: 'Orca',
    aliases: ['orca', 'orca swap', 'orca protocol'],
    category: 'dex-amm',
    tags: ['dex', 'amm', 'swap', 'concentrated-liquidity'],
  },
  marinade: {
    name: 'Marinade Finance',
    aliases: ['marinade', 'marin', 'marinade stake', 'marinade finance'],
    category: 'staking',
    tags: ['staking', 'liquid-staking', 'lsol'],
  },
  lido: {
    name: 'Lido',
    aliases: ['lido', 'lido stake'],
    category: 'staking',
    tags: ['staking', 'liquid-staking'],
  },
  drift: {
    name: 'Drift Protocol',
    aliases: ['drift', 'drift protocol', 'driftprotocol'],
    category: 'derivatives',
    tags: ['perps', 'futures', 'leverage', 'trading'],
  },
  mango: {
    name: 'Mango Markets',
    aliases: ['mango', 'mango markets'],
    category: 'derivatives',
    tags: ['margin', 'trading', 'leverage', 'perps'],
  },
  jupiter: {
    name: 'Jupiter',
    aliases: ['jupiter', 'jup', 'jupiter aggregator'],
    category: 'dex-aggregator',
    tags: ['swap', 'aggregator', 'routing', 'best-price'],
  },
  solend: {
    name: 'Solend',
    aliases: ['solend', 'lending'],
    category: 'lending',
    tags: ['lending', 'borrow', 'collateral', 'interest'],
  },
  'yin-finance': {
    name: 'Yin Finance',
    aliases: ['yin', 'yin finance'],
    category: 'lending',
    tags: ['lending', 'stablecoin'],
  },
  serum: {
    name: 'Serum',
    aliases: ['serum', 'srm'],
    category: 'dex',
    tags: ['order-book', 'dex', 'trading'],
  },
  phantom: {
    name: 'Phantom',
    aliases: ['phantom', 'wallet'],
    category: 'wallet',
    tags: ['wallet', 'browser-extension'],
  },
  backpack: {
    name: 'Backpack',
    aliases: ['backpack', 'wallet'],
    category: 'wallet',
    tags: ['wallet', 'browser-extension'],
  },
  metaplex: {
    name: 'Metaplex',
    aliases: ['metaplex', 'nft', 'token-metadata'],
    category: 'infrastructure',
    tags: ['nft', 'metadata', 'mpl-token-metadata'],
  },
  anchor: {
    name: 'Anchor',
    aliases: ['anchor', 'framework'],
    category: 'development',
    tags: ['framework', 'rust', 'idl'],
  },
}

/**
 * Auto-detect if a project name/IDL matches a known program
 * Case-insensitive, matches full name or any alias
 *
 * @param projectName - Name of the project (e.g., "Raydium", "pump.fun")
 * @returns Matching KnownProgram or null
 */
export function detectKnownProgram(projectName: string): KnownProgram | null {
  const lowerName = projectName.toLowerCase().trim()

  // Check all known programs
  for (const [key, program] of Object.entries(KNOWN_PROGRAMS)) {
    // Check exact name match
    if (program.name.toLowerCase() === lowerName) {
      return program
    }

    // Check if any alias matches
    for (const alias of program.aliases) {
      if (alias.toLowerCase() === lowerName) {
        return program
      }
    }
  }

  return null
}

/**
 * Auto-seed program category when project is created
 * Call this after inserting into projects table
 *
 * @param db - D1 database instance
 * @param projectId - Project ID
 * @param projectName - Project name (will be matched against known programs)
 */
export async function autoSeedCategory(
  db: D1Database,
  projectId: string,
  projectName: string,
): Promise<{ seeded: boolean; program?: KnownProgram }> {
  try {
    const known = detectKnownProgram(projectName)

    if (!known) {
      // Not a known program, skip
      return { seeded: false }
    }

    // Check if category already exists (shouldn't happen, but just in case)
    const existing = await db
      .prepare('SELECT id FROM program_categories WHERE project_id = ? LIMIT 1')
      .bind(projectId)
      .first()

    if (existing) {
      return { seeded: false, program: known } // Already seeded
    }

    // Insert category metadata
    const categoryId = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const tagsStr = known.tags.join(',')
    const aliasesStr = known.aliases.join(',')

    await db
      .prepare(
        'INSERT INTO program_categories (id, project_id, category, tags, aliases, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      )
      .bind(categoryId, projectId, known.category, tagsStr, aliasesStr)
      .run()

    console.log(`✅ Auto-seeded: ${known.name} → ${known.category}`)
    return { seeded: true, program: known }
  } catch (error) {
    console.error(`❌ Error auto-seeding category for ${projectName}:`, error)
    // Don't throw - let the project creation succeed even if category seeding fails
    return { seeded: false }
  }
}
