# CLI Package

On-chain discovery utilities for finding Solana programs and checking whether they publish Anchor IDLs.

## Commands

```bash
bun run cli:scan -- --rpc-url https://api.mainnet-beta.solana.com --out-dir ./output
bun run cli:check-idl -- --rpc-url https://api.mainnet-beta.solana.com --out-dir ./output
bun run cli:full -- --rpc-url https://api.mainnet-beta.solana.com --out-dir ./output
```

## What It Does

- `scan` finds executable programs on a Solana cluster.
- `check-idl` checks scanned programs for on-chain Anchor IDLs.
- `full` runs scan and IDL checking in sequence.

Common options:

- `--rpc-url`
- `--out-dir`
- `--max-programs`
- `--batch-size`
- `--concurrency`
- `--rps`
- `--resume`

Generated files are written to `output/`.

See [../../docs/cli-discovery.md](../../docs/cli-discovery.md) for full documentation.
