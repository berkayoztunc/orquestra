# CLI Tool: Solana Program Scanner

The orquestra CLI tool provides utilities for discovering and analyzing Solana programs on-chain. It can scan entire clusters for executable programs and check which programs have Anchor on-chain IDLs.

## Overview

The CLI tool consists of three main commands:

| Command | Purpose | Output |
|---------|---------|--------|
| `scan` | Discover all executable programs on a cluster | `programs.csv` |
| `check-idl` | Check which programs have on-chain Anchor IDL | `program_idl_status.csv` |
| `full` | Run both scan + check-idl sequentially | Both CSVs |

## Installation

The CLI is part of the orquestra monorepo in the `packages/cli` package:

```bash
cd orquestra
bun install
```

## Quick Start

### 1. Scan Programs

Discover all executable programs on Solana mainnet:

```bash
bun run cli:scan -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./output
```

**Output:** `output/programs.csv`
```csv
program_id,loader
MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD,upgradeable
JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4,upgradeable
...
```

### 2. Check On-Chain IDL

Check which programs have Anchor IDL accounts:

```bash
bun run cli:check-idl -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./output
```

**Output:** `output/program_idl_status.csv`
```csv
program_id,has_onchain_idl,idl_account,error
MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD,true,9jWC3EixD3D7ChMrrSRw3opnGHQ8YxZGJqGkzcup3tAn,
JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4,true,C88XWfp26heEmDkmfSzeXP7Fd7GQJ2j9dDTUsyiZbUTa,
SomeOtherProgram111111111111111111111111111,false,8Pt1hkMe8yxmMuaRvv1ozBoqwbYh3rmaemDbV68JZiPX,
```

### 3. Full Pipeline

Run both commands sequentially:

```bash
bun run cli:full -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./output
```

## Command Reference

### Global Options

All commands support these options:

| Option | Description | Default | Required |
|--------|-------------|---------|----------|
| `--rpc-url <url>` | Solana RPC endpoint URL | `$SOLANA_RPC_URL` env | ✅ |
| `--out-dir <dir>` | Output directory for CSV files | `./output` | ❌ |
| `--rps <n>` | Max requests per second (rate limit) | `10` | ❌ |
| `--resume` | Resume from previous checkpoint | `false` | ❌ |
| `--help` | Show help message | - | ❌ |

### `scan` Command

Scans the cluster for all executable programs.

**Usage:**
```bash
bun run cli:scan -- [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `--max-programs <n>` | Limit number of programs (0 = unlimited) | `0` |
| `--include-legacy-v1` | Include BPF Loader v1 programs | `false` |
| `--no-legacy-v2` | Exclude BPF Loader v2 programs | includes v2 |

**Examples:**
```bash
# Scan all programs on mainnet (WARNING: 50K+ programs, takes time!)
bun run cli:scan -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./mainnet-scan

# Limit to first 1000 programs for testing
bun run cli:scan -- --rpc-url 'https://api.mainnet-beta.solana.com' --max-programs 1000

# Scan devnet with custom RPC
bun run cli:scan -- --rpc-url 'https://api.devnet.solana.com' --out-dir ./devnet-scan

# Use custom RPC with API key (quote the URL!)
bun run cli:scan -- --rpc-url 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY' --rps 20
```

**Output:**
- `programs.csv` - List of all discovered programs
- `.program-list.json` - Internal file used by `check-idl` command
- `.checkpoint-scan.json` - Resume checkpoint (if interrupted)

### `check-idl` Command

Checks each program for on-chain Anchor IDL.

**Usage:**
```bash
bun run cli:check-idl -- [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `--input-file <path>` | Custom JSON file with program IDs | `<out-dir>/.program-list.json` |
| `--batch-size <n>` | Number of programs to check per batch | `50` |
| `--concurrency <n>` | Concurrent RPC calls per batch | `10` |

**Examples:**
```bash
# Check IDL for programs from previous scan
bun run cli:check-idl -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./output

# Check custom list of programs
echo '["MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD","JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"]' > programs.json
bun run cli:check-idl -- --rpc-url 'https://api.mainnet-beta.solana.com' --input-file ./programs.json

# Resume interrupted check
bun run cli:check-idl -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./output --resume

# Smaller batches for public RPC (reduces rate-limit errors)
bun run cli:check-idl -- --rpc-url 'https://api.mainnet-beta.solana.com' --batch-size 25 --rps 5
```

**Output:**
- `program_idl_status.csv` - IDL status for each program
- `.checkpoint-idl.json` - Resume checkpoint (if interrupted)

### `full` Command

Runs `scan` followed by `check-idl`.

**Usage:**
```bash
bun run cli:full -- [options]
```

Accepts all options from both `scan` and `check-idl` commands.

**Example:**
```bash
# Full pipeline with 500 program limit
bun run cli:full -- \
  --rpc-url 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY' \
  --out-dir ./results \
  --max-programs 500 \
  --batch-size 50 \
  --rps 15
```

## Advanced Usage

### Resume After Interruption

If a scan or IDL check is interrupted (network error, rate limit, Ctrl+C), you can resume:

```bash
# First run (interrupted)
bun run cli:check-idl -- --rpc-url 'https://...' --out-dir ./output
# ... interrupted at 4523/10000 ...

# Resume from checkpoint
bun run cli:check-idl -- --rpc-url 'https://...' --out-dir ./output --resume
# ✓ Resuming: 4523 already processed, 5477 remaining
```

### Rate Limiting & RPC Considerations

**Public RPCs** (api.mainnet-beta.solana.com):
- Very strict rate limits
- Use `--rps 2` to `--rps 5`
- Expect frequent 429 errors; the tool will retry automatically

**Premium RPCs** (Helius, QuickNode, etc.):
- Higher rate limits
- Use `--rps 10` to `--rps 50` depending on tier
- More reliable for large scans

**Recommended Settings:**

```bash
# Public RPC (slow but free)
bun run cli:scan -- --rpc-url 'https://api.mainnet-beta.solana.com' \
  --max-programs 100 --rps 2

# Premium RPC (fast, requires API key)
bun run cli:scan -- --rpc-url 'https://mainnet.helius-rpc.com/?api-key=KEY' \
  --rps 20 --batch-size 100
```

### Custom Program Lists

You can provide your own program list for IDL checking:

```bash
# Create a JSON array of program IDs
cat > my-programs.json << EOF
[
  "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
]
EOF

# Check IDL for those programs
bun run cli:check-idl -- \
  --rpc-url 'https://api.mainnet-beta.solana.com' \
  --input-file ./my-programs.json \
  --out-dir ./custom-check
```

## Technical Details

### Anchor IDL Detection

The tool checks for Anchor IDL using **both** derivation methods to support all Anchor versions:

1. **Old Anchor (<0.30):** `createWithSeed(base, "anchor:idl", programId)` where `base = PDA([], programId)`
2. **New Anchor (≥0.30):** `PDA(["anchor:idl", programId], programId)`

If either account exists, the program is marked as having on-chain IDL.

### Program Discovery

Programs are discovered by querying `getProgramAccounts` on BPF Loader programs:

- **BPFLoaderUpgradeable** (`BPFLoaderUpgradeab1e11111111111111111111111`) - Modern upgradeable programs
- **BPF Loader v2** (optional, `--include-legacy-v2`) - Legacy non-upgradeable programs
- **BPF Loader v1** (optional, `--include-legacy-v1`) - Deprecated loader

### Output Files

| File | Purpose | Can be deleted? |
|------|---------|-----------------|
| `programs.csv` | Final program list | ❌ Keep |
| `program_idl_status.csv` | Final IDL status | ❌ Keep |
| `.program-list.json` | Intermediate data for check-idl | ✅ After check-idl completes |
| `.checkpoint-scan.json` | Resume checkpoint for scan | ✅ After scan completes |
| `.checkpoint-idl.json` | Resume checkpoint for check-idl | ✅ After check-idl completes |

## Troubleshooting

### "429 Too Many Requests"

**Problem:** RPC is rate-limiting your requests.

**Solutions:**
- Lower `--rps` value: `--rps 2` or `--rps 1`
- Use a premium RPC provider with higher limits
- Use `--resume` to continue after waiting

### "Error: Program list not found"

**Problem:** Running `check-idl` before `scan`.

**Solution:**
```bash
# Run scan first
bun run cli:scan -- --rpc-url 'https://...' --out-dir ./output

# Then check-idl
bun run cli:check-idl -- --rpc-url 'https://...' --out-dir ./output
```

Or provide a custom list:
```bash
bun run cli:check-idl -- --input-file ./my-programs.json --out-dir ./output
```

### Slow Performance

**Problem:** Scanning 50K+ programs takes hours on public RPC.

**Solutions:**
- Use `--max-programs` to limit scope: `--max-programs 1000`
- Use premium RPC with higher `--rps`
- Run overnight for full cluster scans
- Use `--resume` if interrupted

### Out of Memory

**Problem:** Node/Bun runs out of memory on very large scans.

**Solution:** The tool streams results to CSV, so this is rare. If it happens:
- Run scan and check-idl separately (not `full`)
- Lower `--batch-size`: `--batch-size 25`
- Process in chunks with `--max-programs`, then merge CSVs manually

## Examples

### Find All Anchor Programs on Mainnet

```bash
# Step 1: Scan all programs (warning: 50K+, takes time!)
bun run cli:scan -- \
  --rpc-url 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY' \
  --out-dir ./anchor-programs \
  --rps 20

# Step 2: Check which have on-chain IDL
bun run cli:check-idl -- \
  --rpc-url 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY' \
  --out-dir ./anchor-programs \
  --batch-size 100 \
  --rps 20

# Step 3: Filter CSV for programs with IDL
grep ",true," ./anchor-programs/program_idl_status.csv > anchor_programs_with_idl.csv
```

### Quick Survey of Top 100 Programs

```bash
bun run cli:full -- \
  --rpc-url 'https://api.mainnet-beta.solana.com' \
  --out-dir ./top100 \
  --max-programs 100 \
  --rps 3 \
  --batch-size 20
```

### Check Specific Programs (e.g., DeFi protocols)

```bash
cat > defi-programs.json << EOF
[
  "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
]
EOF

bun run cli:check-idl -- \
  --rpc-url 'https://api.mainnet-beta.solana.com' \
  --input-file ./defi-programs.json \
  --out-dir ./defi-idl-check
```

## Integration with orquestra

The CLI tool complements the orquestra web platform:

1. **Use CLI to discover** programs with on-chain IDL
2. **Import them into orquestra** via the dashboard or API
3. **Auto-generate REST APIs** without manual IDL upload

Future integration may include automatic import from CLI scan results.

## Contributing

The CLI tool lives in `packages/cli/`. Contributions welcome:

- Add support for other program loaders
- Improve IDL detection heuristics
- Add export formats (JSON, SQL, etc.)
- Performance optimizations for large scans

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.
