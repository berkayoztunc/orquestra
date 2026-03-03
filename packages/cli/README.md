# CLI Tools

Command-line utilities for discovering and analyzing Solana programs on-chain.

## Overview

The orquestra CLI provides tools to:

- **Scan** entire Solana clusters for executable programs
- **Check** which programs have on-chain Anchor IDL
- **Export** results to CSV for analysis

## Quick Start

```bash
# From repository root
bun install

# Scan programs on mainnet
bun run cli:scan -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./output

# Check IDL availability
bun run cli:check-idl -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./output

# Or run both
bun run cli:full -- --rpc-url 'https://api.mainnet-beta.solana.com' --out-dir ./output
```

## Commands

### `scan`

Discovers all executable programs using:
- BPFLoaderUpgradeable (modern upgradeable programs)
- BPF Loader v2 (legacy non-upgradeable)
- BPF Loader v1 (deprecated, optional)

**Output:** `programs.csv` with columns: `program_id`, `loader`

### `check-idl`

Checks each program for on-chain Anchor IDL using both derivation methods:
- Old Anchor (<0.30): `createWithSeed` method
- New Anchor (≥0.30): PDA method

**Output:** `program_idl_status.csv` with columns: `program_id`, `has_onchain_idl`, `idl_account`, `error`

### `full`

Runs `scan` followed by `check-idl` in sequence.

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--rpc-url` | Solana RPC endpoint (required) | `$SOLANA_RPC_URL` |
| `--out-dir` | Output directory | `./output` |
| `--max-programs` | Limit number of programs | `0` (unlimited) |
| `--batch-size` | Programs per IDL batch | `50` |
| `--concurrency` | Concurrent RPC calls | `10` |
| `--rps` | Max requests per second | `10` |
| `--resume` | Resume from checkpoint | `false` |

## Examples

```bash
# Test with 100 programs
bun run cli:scan -- --rpc-url 'https://api.mainnet-beta.solana.com' --max-programs 100

# Premium RPC with higher rate limit
bun run cli:scan -- --rpc-url 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY' --rps 20

# Custom program list
echo '["MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD"]' > programs.json
bun run cli:check-idl -- --input-file ./programs.json

# Resume interrupted check
bun run cli:check-idl -- --rpc-url 'https://...' --resume
```

## Architecture

```
src/
├── index.ts              # CLI entry point
├── commands/
│   ├── scan-programs.ts  # Program discovery
│   └── check-idl.ts      # IDL checker
└── lib/
    ├── rpc.ts            # RPC client with retry/rate-limit
    ├── program-discovery.ts
    ├── anchor-idl-check.ts
    ├── csv.ts            # CSV writer
    └── checkpoint.ts     # Resume support
```

## Output Files

| File | Description |
|------|-------------|
| `programs.csv` | Final program list |
| `program_idl_status.csv` | IDL availability per program |
| `.program-list.json` | Intermediate data (auto-generated) |
| `.checkpoint-*.json` | Resume checkpoints (auto-generated) |

## Documentation

See [docs/CLI_TOOL.md](../../docs/CLI_TOOL.md) for complete documentation including:
- Advanced usage
- Rate limiting strategies
- Troubleshooting
- Integration examples

## Development

```bash
# Install dependencies
bun install

# Run locally
bun run src/index.ts scan --help

# Type check
bun run type-check
```

## License

MIT
