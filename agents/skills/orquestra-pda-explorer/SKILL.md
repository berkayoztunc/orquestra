---
name: orquestra-pda-explorer
description: "Use when you need to derive Program Derived Addresses (PDAs), resolve missing accounts, or inspect on-chain PDA data — all via Orquestra MCP only. Use when a user says 'derive PDA', 'find my stake account', 'resolve missing accounts', 'what's in the vault PDA', 'fetch account data', 'PDA for wallet', or 'fill missing accounts'."
argument-hint: "Program ID or name, known seed values (wallet pubkey, token mint, etc.), and the target account role."
---

# Orquestra PDA Explorer

Account resolution skill. Uses ONLY Orquestra MCP tools to derive PDA addresses,
fetch their on-chain data, and iteratively resolve all required accounts.

## Constraints

- ONLY use Orquestra MCP tools: `list_pda_accounts`, `derive_pda`, `fetch_pda_data`
- DO NOT search programs, build transactions, or sign anything
- DO NOT guess seed values — ask the user for the exact missing seed
- DO NOT proceed to build if required accounts are still unresolved

## Resolution Loop

For each unresolved account:

1. Call `list_pda_accounts` → get seed schema for the target account type
2. Call `derive_pda` with available seeds
3. Call `fetch_pda_data` on the derived address
4. Extract new pubkeys from returned fields → use to fill other missing accounts
5. Repeat until all required accounts are filled
6. If a seed is still missing, ask for ONLY that exact seed value

## Solana System Constants (use without asking)

| Program | Address |
|---------|---------|
| System Program | `11111111111111111111111111111111` |
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| ATA Program | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |
| Sysvar Rent | `SysvarRent111111111111111111111111111111111` |
| Sysvar Clock | `SysvarC1ock11111111111111111111111111111111` |

## Output Format

For each PDA:
```
Account Role:     <name>
Seeds:            [<seed1>, <seed2>]
Derived Address:  <base58_address>
On-chain Data:    { field: value, ... }
```

List remaining unresolved accounts with the exact missing seed name.
When complete: "All accounts resolved → hand off to orquestra-tx-builder."
