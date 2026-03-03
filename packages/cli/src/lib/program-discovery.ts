/**
 * Program Discovery
 * Discovers all executable Solana programs on a cluster via getProgramAccounts.
 *
 * Strategy:
 * 1. Fetch all accounts owned by BPFLoaderUpgradeable (BPFLoaderUpgradeab1e11111111111111111111111)
 *    that are ProgramData accounts (first byte discriminator = 3 for ProgramData variant).
 * 2. Extract the program address from the ProgramData account's associated Program account.
 *
 * Alternative: We query getProgramAccounts with an executable filter on the system,
 * but the most reliable way is using getSlot + paginated getAccountInfo.
 *
 * Due to cluster-wide scan constraints (RPC limits), we use getProgramAccounts
 * with memcmp filters on the BPFLoaderUpgradeable loader, which returns all
 * UpgradeableLoader Program accounts.
 */

import { RpcClient } from './rpc'

/** BPF Loader Upgradeable program ID */
const BPF_LOADER_UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111'

/** Legacy BPF Loader v2 */
const BPF_LOADER_V2 = 'BPFLoader2111111111111111111111111111111111'

/** Legacy BPF Loader v1 (deprecated) */
const BPF_LOADER_V1 = 'BPFLoader1111111111111111111111111111111111'

export interface DiscoveredProgram {
  programId: string
  loader: 'upgradeable' | 'v2' | 'v1'
}

export interface DiscoveryOptions {
  /** Include legacy BPF Loader v2 programs (default: true) */
  includeLegacyV2?: boolean
  /** Include legacy BPF Loader v1 programs (default: false) */
  includeLegacyV1?: boolean
  /** Max programs to return (0 = unlimited). Useful for testing. */
  maxPrograms?: number
  /** Progress callback */
  onProgress?: (msg: string) => void
}

/**
 * Discover all executable programs on the cluster.
 *
 * Works by querying accounts owned by each BPF Loader and filtering executables.
 * The Upgradeable Loader accounts include both Program and ProgramData;
 * we filter to only Program accounts (36-byte data length = Program variant).
 */
export async function discoverPrograms(
  rpc: RpcClient,
  opts: DiscoveryOptions = {}
): Promise<DiscoveredProgram[]> {
  const { includeLegacyV2 = true, includeLegacyV1 = false, maxPrograms = 0, onProgress } = opts
  const programs: DiscoveredProgram[] = []

  // 1. Upgradeable Loader — get all Program accounts (discriminator byte 2 = Program variant, 36 bytes)
  onProgress?.('Fetching programs from BPFLoaderUpgradeable...')
  const upgradeablePrograms = await fetchUpgradeablePrograms(rpc)
  onProgress?.(`  Found ${upgradeablePrograms.length} upgradeable programs`)
  for (const p of upgradeablePrograms) {
    programs.push({ programId: p, loader: 'upgradeable' })
    if (maxPrograms > 0 && programs.length >= maxPrograms) return programs
  }

  // 2. Legacy BPF Loader v2
  if (includeLegacyV2) {
    onProgress?.('Fetching programs from BPFLoader v2...')
    const v2Programs = await fetchLegacyPrograms(rpc, BPF_LOADER_V2)
    onProgress?.(`  Found ${v2Programs.length} legacy v2 programs`)
    for (const p of v2Programs) {
      programs.push({ programId: p, loader: 'v2' })
      if (maxPrograms > 0 && programs.length >= maxPrograms) return programs
    }
  }

  // 3. Legacy BPF Loader v1
  if (includeLegacyV1) {
    onProgress?.('Fetching programs from BPFLoader v1...')
    const v1Programs = await fetchLegacyPrograms(rpc, BPF_LOADER_V1)
    onProgress?.(`  Found ${v1Programs.length} legacy v1 programs`)
    for (const p of v1Programs) {
      programs.push({ programId: p, loader: 'v1' })
      if (maxPrograms > 0 && programs.length >= maxPrograms) return programs
    }
  }

  return programs
}

/**
 * Fetch all programs deployed via BPFLoaderUpgradeable.
 * Uses getProgramAccounts with a dataSize filter of 36 bytes
 * (UpgradeableLoaderState::Program variant is exactly 36 bytes:
 *  4 bytes enum discriminator + 32 bytes programdata address).
 */
async function fetchUpgradeablePrograms(rpc: RpcClient): Promise<string[]> {
  const result = await rpc.call<Array<{ pubkey: string; account: { data: [string, string]; executable: boolean } }>>(
    'getProgramAccounts',
    [
      BPF_LOADER_UPGRADEABLE,
      {
        encoding: 'base64',
        filters: [{ dataSize: 36 }],   // Program variant = 36 bytes
        commitment: 'confirmed',
      },
    ]
  )

  // Each returned pubkey is an executable program
  return result.map((r) => r.pubkey)
}

/**
 * Fetch all programs from a legacy BPF Loader.
 * Legacy loaders mark program accounts as executable.
 * We just request all accounts owned by the loader — they are all executable programs.
 * We use dataSlice to minimise data transfer (we only need pubkeys).
 */
async function fetchLegacyPrograms(rpc: RpcClient, loader: string): Promise<string[]> {
  const result = await rpc.call<Array<{ pubkey: string; account: any }>>(
    'getProgramAccounts',
    [
      loader,
      {
        encoding: 'base64',
        dataSlice: { offset: 0, length: 0 }, // we don't need account data
        commitment: 'confirmed',
      },
    ]
  )

  return result.map((r) => r.pubkey)
}
