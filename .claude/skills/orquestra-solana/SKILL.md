---
name: orquestra-solana
description: |
  End-to-end guide for executing Solana transactions via the Orquestra agent pipeline.
  Use when performing any Solana operation: staking, swapping, minting, transferring,
  or any Anchor program interaction using the Orquestra agents.
  Triggers: "stake sol", "swap token", "solana transaction", "use orquestra to",
  "send transaction", "interact with program", "call instruction", "build and sign",
  "orquestra pipeline", "full pipeline", "execute on solana", "solana agent",
  "marinade deposit", "jupiter swap", "mint token", "transfer spl".
---

# Orquestra Solana Pipeline

The Orquestra agent pipeline executes Solana tasks end-to-end in 4 stages.
Each stage is a specialized sub-agent. The `orquestra` orchestrator manages them.

## Pipeline Overview

```
User intent
    │
    ▼
[1] orquestra-researcher   — find program, list instructions + PDAs
    │
    ▼
[2] orquestra-pda-explorer — derive PDAs, resolve all required accounts
    │
    ▼
[3] orquestra-tx-builder   — build unsigned base64 wire transaction
    │
    ▼
[3.5] orquestra-simulator  — preflight: compute units, Anchor error decode
    │
    ▼ (user confirms)
[4] orquestra-signer       — sign + send, explicit YES required
```

## How to Start

Say the task in plain English to the `orquestra` orchestrator:

> "Stake 2 SOL with Marinade for wallet `9xTy...pQr2`"
> "Swap 1 SOL to USDC on Jupiter"
> "Derive the stake account PDA for Marinade"
> "What instructions does the Kamino lending program have?"

The orchestrator decides which stages to run. Research-only tasks stop at Stage 1.

---

## Stage 1 — Research (orquestra-researcher)

**What it does**: searches the Orquestra registry, reads docs, lists instructions and PDA schemas.

**MCP tools used**: `search_programs`, `read_llms_txt`, `list_instructions`, `list_pda_accounts`, `get_ai_analysis`

**What you get back**:
- Program name + projectId
- All instructions (name, args, accounts)
- All PDA account types + seed schemas

**You only need to provide**: program name or keyword (e.g. "Marinade", "Jupiter", "Kamino")

---

## Stage 2 — Account Resolution (orquestra-pda-explorer)

**What it does**: derives every PDA address required by the instruction.

**MCP tools used**: `list_pda_accounts`, `derive_pda`, `fetch_pda_data` (via Orquestra MCP)

**What you need to provide**:
- Your wallet public key (fee payer / authority / signer)
- Any token mint addresses if the instruction requires them
- Any other user-provided seeds (amounts are NOT seeds)

**What the agent resolves automatically**:
- All PDAs derivable from your wallet + known program constants
- Nested PDAs (fetches on-chain data to extract further addresses)

**What it asks you for**: ONLY seeds it cannot derive — it names the exact field.

---

## Stage 3 — Transaction Build (orquestra-tx-builder)

**What it does**: calls `build_instruction` with all resolved accounts and your provided args.

**MCP tools used**: `build_instruction`

**What you must have ready**:
- All account addresses (from Stage 2)
- All argument values (amounts in correct units — see below)
- Fee payer wallet pubkey

**Returns**: unsigned base64 wire transaction + risk level + estimated fee

### Amount Units

| Token | Unit | Example: 1 SOL |
|-------|------|----------------|
| SOL | lamports (u64) | `1000000000` |
| USDC | micro-USDC (u64, 6 decimals) | `1000000` |
| SPL token | raw units (check token decimals) | varies |

---

## Stage 3.5 — Simulation (orquestra-simulator)

**What it does**: preflights the transaction. No wallet interaction. Decodes Anchor errors.

**MCP tools used**: `simulate_instruction`

**Simulation passes** → shows compute units consumed → proceeds to signer
**Simulation fails** → shows decoded Anchor error (`name`, `code`, `msg`) → STOPS

If simulation fails, fix the error before asking to sign. Common failures:
- `InsufficientFunds` — wallet balance too low
- `InvalidAccountData` — wrong PDA seed / account type mismatch
- `AccountNotInitialized` — an account must be created first
- Custom Anchor error — check `decodedError.msg` for constraint name

---

## Stage 4 — Sign & Send (orquestra-signer)

**What it does**: shows approval summary, waits for explicit YES, then signs and submits.

**MCP tools used**: `get_signer_address`, `sign_and_send_transaction` (signer-mcp)

**Approval summary shown before every signature**:
```
Network:        mainnet-beta
Signer Wallet:  <your pubkey>
Program:        <program name>
Instruction:    <instruction>
Estimated Fee:  <lamports>
Risk Level:     LOW / MEDIUM / HIGH
```

Type **YES** to sign. Any other response cancels.

**Returns on success**:
```
Tx Signature: <base58>
Explorer: https://explorer.solana.com/tx/<sig>?cluster=mainnet-beta
```

---

## Solana Constants (used as accounts, not user input)

| Program | Address |
|---------|---------|
| System Program | `11111111111111111111111111111111` |
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| ATA Program | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |
| Sysvar Rent | `SysvarRent111111111111111111111111111111111` |

---

## Research-Only Mode

If you only want program info (no transaction), say so explicitly:

> "What instructions does Marinade have?" → Stage 1 only, no transaction built
> "Show me the PDA accounts for Kamino" → Stage 1 + Stage 2, stops before build
> "What is the AI analysis for Jupiter?" → `get_ai_analysis` only

---

## Hard Rules

- NEVER invent account addresses or PDA values — agent derives them from chain data
- NEVER skip simulation — always run before signing
- NEVER assume token amounts — ask for clarification if units are ambiguous
- Signing requires **explicit YES** — ambiguous confirmation is NOT approval
