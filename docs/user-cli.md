# User CLI

The user-facing Orquestra CLI is a separate Rust companion project:

```text
https://github.com/berkayoztunc/orquestra-cli
```

It can work against the hosted Orquestra API or against a local Anchor IDL file.

## Modes

### API Mode

Use an Orquestra project ID and project API key.

```bash
orquestra config set \
  --project-id <project-id> \
  --api-key <api-key> \
  --rpc https://api.mainnet-beta.solana.com \
  --keypair ~/.config/solana/id.json
```

### Local IDL Mode

Use a local IDL without an Orquestra account.

```bash
orquestra config set \
  --idl ./target/idl/my_program.json \
  --rpc https://api.mainnet-beta.solana.com \
  --keypair ~/.config/solana/id.json
```

## Commands

```bash
orquestra
orquestra list
orquestra run <instruction>
orquestra pda <account>
orquestra sign <base58_tx>
orquestra simulate <base58_tx>
orquestra tx <signature>
orquestra search <query>
orquestra idl fetch <program_id> -o output.json
orquestra config set
orquestra config show
orquestra config reset
orquestra --version
orquestra --help
```

## Features

- Interactive instruction picker
- Per-argument prompts
- Signer account autofill from local keypair
- PDA derivation from IDL seed metadata
- Local signing and broadcasting
- Unsigned transaction output when no keypair is configured
- Local IDL mode for offline development
- API mode for hosted Orquestra projects
- Transaction inspection and simulation helpers

## Examples

List instructions:

```bash
orquestra list
```

Run an instruction:

```bash
orquestra run deposit \
  --arg amount=1000000 \
  --account authority=<pubkey> \
  --account vault=<pubkey> \
  --yes
```

Derive a PDA:

```bash
orquestra pda vault --seed owner=<pubkey>
```

Search hosted programs:

```bash
orquestra search marginfi
```

Inspect a confirmed transaction:

```bash
orquestra tx <signature>
```
