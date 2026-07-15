A fast Rust CLI for interacting with Solana programs via IDL. Upload your Anchor IDL to Orquestra once — or point the CLI at a local IDL file — and turn every instruction into an interactive prompt that builds, signs, and sends transactions to Solana.

[Download Latest Release](https://github.com/berkayoztunc/orquestra-cli/releases) · [View on GitHub](https://github.com/berkayoztunc/orquestra-cli)

## Features

- **Interactive run** — fuzzy-select an instruction, answer per-arg prompts, and execute, all from one command. Auto-fills signer accounts and signs & sends in one step.
- **PDA derivation** — fuzzy-select a PDA account, enter seed values, and instantly derive the address and bump. Reads seeds directly from the IDL.
- **Local IDL file mode** — point the CLI at any Anchor IDL JSON file and operate fully offline, no Orquestra account needed.
- **Keypair integration** — loads your standard Solana CLI keypair to pre-fill signer accounts and sign transactions locally. Falls back to an unsigned-transaction mode when no keypair is configured.
- **Instruction list** — view all instructions in your program with a single command, works in both API and file mode.
- **Persistent config** — settings are stored in `~/.config/orquestra/config.toml` and reused across sessions.

## Installation

**Homebrew (macOS — recommended)**

```bash
brew tap berkayoztunc/orquestra-cli https://github.com/berkayoztunc/orquestra-cli
brew install orquestra-cli
```

**Download binary (all platforms)**

Grab the latest binary from the [Releases page](https://github.com/berkayoztunc/orquestra-cli/releases):

| Platform | Archive |
| --- | --- |
| macOS arm64 | `orquestra-vX.X.X-aarch64-apple-darwin.tar.gz` |
| macOS x86_64 | `orquestra-vX.X.X-x86_64-apple-darwin.tar.gz` |
| Linux x86_64 | `orquestra-vX.X.X-x86_64-unknown-linux-gnu.tar.gz` |
| Linux arm64 | `orquestra-vX.X.X-aarch64-unknown-linux-gnu.tar.gz` |

```bash
tar -xzf orquestra-*.tar.gz
mv orquestra /usr/local/bin/
```

**Build from source (Rust 1.75+)**

```bash
git clone https://github.com/berkayoztunc/orquestra-cli
cd orquestra-cli
cargo build --release
# binary -> target/release/orquestra
```

## Setup

Two operating modes — pick the one that fits your workflow.

- **API mode (default)** — you have an Orquestra account and API key. All instruction metadata is fetched from the cloud.
- **Local IDL file mode** — you have an Anchor IDL JSON file locally. Works fully offline, no Orquestra account needed.

**API mode config:**

```bash
orquestra config set \
  --project-id <your-project-id> \
  --api-key    <your-api-key> \
  --rpc        https://api.mainnet-beta.solana.com \
  --keypair    ~/.config/solana/id.json
```

Sign in at [orquestra.dev](/), upload your Anchor IDL, and generate an API key from the dashboard.

**Local IDL file mode config:**

```bash
orquestra config set \
  --idl     /path/to/program.json \
  --rpc     https://api.mainnet-beta.solana.com \
  --keypair ~/.config/solana/id.json
```

When `idl_path` is set, the CLI operates in file mode. To switch back: `orquestra config set --idl ""`

## Usage examples

**List instructions**

```bash
orquestra list

> 4 instructions in my-program

  initialize    Initializes a new vault account
  deposit       Deposit tokens into the vault
  withdraw      Withdraw tokens from the vault
  close         Close the vault and reclaim rent
```

**Run an instruction (interactive)**

```bash
orquestra run

? Select instruction  > deposit

Instruction: deposit

Arguments
  amount (u64): 1000000

Accounts
  authority [signer]: Gk3...abc (pre-filled from keypair)
  vault [mut]:        Fv9...xyz

? Build transaction for 'deposit'? > Yes

Transaction built successfully!
  Estimated fee : 5000 lamports

? Sign and send transaction to Solana? > Yes

Transaction confirmed!
  Signature : 5KtP...Xz
  Explorer  : https://explorer.solana.com/tx/5KtP...Xz
```

**Derive a PDA**

```bash
orquestra pda

> 2 PDA accounts in my-program (BUYu...)

? Select PDA account  > vault (owner)

Seed values
  owner (publicKey): Gk3...abc

PDA derived!

  Address:   Fv9...xyz
  Bump:      254
  Program:   BUYu...
```

**Without a keypair**

If no keypair is configured, the CLI prints an unsigned base58 transaction for manual wallet signing.

```text
Base58 encoded transaction (unsigned):
  4h8nK3F9x2rP...vQm7L2wN

  Sign with your wallet and broadcast to Solana.
  https://orquestra.dev/docs/sign-and-send
```

## Command reference

```bash
# Interactive top-level menu
orquestra

# Instructions
orquestra list
orquestra run [INSTRUCTION]

# PDAs
orquestra pda [ACCOUNT]

# Config
orquestra config set [--project-id] [--api-key] [--rpc] [--keypair] [--api-base] [--idl]
orquestra config show
orquestra config reset

# Meta
orquestra --version
orquestra --help
```

> **This project has not been audited.** Use a test wallet with minimal funds when signing and sending transactions. Do not use a wallet that holds significant assets until a full security audit has been completed. You are responsible for any transactions you sign and broadcast to the network.
