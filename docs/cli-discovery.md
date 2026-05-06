# CLI Discovery Tools

The `packages/cli` package contains Bun-based utilities for discovering Solana programs and checking on-chain Anchor IDL availability.

These are not the Rust companion CLI. The Rust user CLI lives in a separate repository: `orquestra-cli`.

## Commands

```bash
bun run cli:scan -- --rpc-url https://api.mainnet-beta.solana.com --out-dir ./output
bun run cli:check-idl -- --rpc-url https://api.mainnet-beta.solana.com --out-dir ./output
bun run cli:full -- --rpc-url https://api.mainnet-beta.solana.com --out-dir ./output
```

## `scan`

Scans a Solana cluster for executable programs.

Loaders:

- BPFLoaderUpgradeable
- BPF Loader v2
- BPF Loader v1 when enabled

Output:

- `programs.csv`
- `.program-list.json`

## `check-idl`

Checks each program for on-chain Anchor IDL data.

It supports:

- Old Anchor `createWithSeed` IDL derivation
- New Anchor PDA IDL derivation

Output:

- `program_idl_status.csv`
- checkpoint files for resume support

## `full`

Runs `scan` and then `check-idl`.

## Common Options

| Option | Purpose |
| --- | --- |
| `--rpc-url` | Solana RPC URL |
| `--out-dir` | Output directory |
| `--max-programs` | Limit scanned programs |
| `--batch-size` | Programs per IDL batch |
| `--concurrency` | Concurrent RPC calls |
| `--rps` | Rate limit |
| `--resume` | Resume from checkpoint |

## Examples

```bash
bun run cli:scan -- --rpc-url https://api.mainnet-beta.solana.com --max-programs 100
```

```bash
bun run cli:check-idl -- --rpc-url https://mainnet.helius-rpc.com/?api-key=YOUR_KEY --rps 20
```

```bash
bun run cli:check-idl -- --rpc-url https://api.mainnet-beta.solana.com --resume
```
