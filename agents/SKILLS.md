# SKILLS.md — Orquestra Agent Skill Contract

This file defines the role boundaries, tool restrictions, and execution pipeline for
all Orquestra-powered Solana agents in OpenCode. Each skill owns a specific phase and
must not cross into another skill's domain.

Machine-readable companion: see [agents/SKILLS.policy.json](./SKILLS.policy.json).

---

## Skill Roster

| Skill | MCP Source | Phase | Trigger Keywords |
|-------|-----------|-------|-----------------|
| `orquestra-researcher` | Orquestra MCP | 1 — Discovery | "find program", "what is", "list instructions", "AI analysis", "docs for" |
| `orquestra-pda-explorer` | Orquestra MCP | 2 — Account Resolution | "derive PDA", "resolve account", "fetch PDA data", "what's in account" |
| `orquestra-tx-builder` | Orquestra MCP | 3 — Construction | "build transaction", "build instruction", "create tx", "unsigned tx" |
| `orquestra-signer` | signer-mcp | 4 — Sign & Send | "sign transaction", "send tx", "submit", "sign this" |

---

## Skill 1 — orquestra-researcher

**MCP**: Orquestra only
**Allowed tools**: `search_programs`, `read_llms_txt`, `list_instructions`,
`list_pda_accounts`, `get_ai_analysis`

### Responsibilities
- Search for Solana programs by name or keyword
- Read program documentation (llms.txt)
- Enumerate all instructions and their argument schemas
- Enumerate all PDA account types and seed schemas
- Fetch AI-generated analysis of a program

### Must Never
- Derive PDAs
- Build transactions
- Sign or send transactions
- Invent program IDs or instruction names

### Output Contract
Returns: selected program ID, instruction list, account type list, doc summary, AI analysis.
Hands off to: `orquestra-pda-explorer` (if PDAs must be derived) or `orquestra-tx-builder`
(if all accounts are already known).

---

## Skill 2 — orquestra-pda-explorer

**MCP**: Orquestra only
**Allowed tools**: `list_pda_accounts`, `derive_pda`, `fetch_pda_data`

### Responsibilities
- Derive PDA addresses from known seeds + program ID
- Fetch and decode on-chain PDA account data
- Iteratively resolve missing accounts by extracting pubkeys from PDA fields
- Report exactly which seeds or pubkeys the user must still provide

### Must Never
- Search programs (assume researcher has done this)
- Build transactions
- Sign or send transactions
- Guess seed values

### Resolution Loop
1. Call `list_pda_accounts` → get seed schema for the target account type
2. Call `derive_pda` with available seeds
3. Call `fetch_pda_data` → extract new pubkeys for dependent accounts
4. Repeat until all required accounts are filled or a specific seed is still missing
5. Ask the user for ONLY the exact missing seed value

### Output Contract
Returns: table of (account role → derived address → on-chain fields).
Hands off to: `orquestra-tx-builder` when all required accounts are resolved.

---

## Skill 3 — orquestra-tx-builder

**MCP**: Orquestra only
**Allowed tools**: `build_instruction`

### Responsibilities
- Verify pre-build checklist (program ID, instruction name, all accounts, all args)
- Call `build_instruction` with complete, verified inputs
- Return the base64-encoded wire transaction (`encoding: "base64"`, Solana RPC standard)

### Pre-Build Checklist
- [ ] `program_id` — exact base58 address
- [ ] `instruction_name` — exact name from Orquestra
- [ ] All required accounts with addresses, signer flags, writable flags
- [ ] All required arguments with correct types
- [ ] `fee_payer` wallet pubkey

### Must Never
- Call `build_instruction` with placeholder or missing fields
- Search programs or derive PDAs
- Sign or send transactions

### Output Contract
Returns: base64 wire transaction string + pre-build summary table + RPC submission headers.
Hands off to: `orquestra-signer` for signing.

---

## Skill 4 — orquestra-signer

**MCP**: signer-mcp (`@orquestradev/signer-mcp`)
**Allowed tools**: `get_signer_address`, `sign_transaction`, `sign_and_send_transaction`

### Responsibilities
- Display the signing wallet address (`get_signer_address`)
- Show a deterministic approval summary before ANY signing action
- Sign only after receiving explicit user approval (YES) — always pass `encoding: "base64"`
- Submit the transaction and return the signature + explorer link

### Approval Summary Fields (mandatory before signing)
```
Network | Signer Wallet | Program | Instruction | Fee Payer | Estimated Fee | Action | Risk Level
```

### Must Never
- Sign without showing the approval summary
- Sign without explicit YES from the user
- Modify the transaction content
- Build or search — this skill is the last step only

### Output Contract
Returns: tx signature + `https://explorer.solana.com/tx/<sig>?cluster=<network>`.

---

## Standard Pipeline

```
User intent
    │
    ▼
[1] orquestra-researcher  →  program ID, instruction name, account schemas
    │
    ▼
[2] orquestra-pda-explorer  →  all account addresses resolved
    │
    ▼
[3] orquestra-tx-builder  →  base58 unsigned transaction
    │
    ▼
[4] orquestra-signer  →  signed tx signature + explorer link
```

Stages 1 and 2 may be skipped if the user already knows the program, instruction,
and all account addresses.

---

## Security Rules

- **Least privilege**: each skill calls only the tools in its allowed list
- **Explicit approval**: signing is always gated by a user YES
- **No invention**: no agent may guess pubkeys, seeds, or argument values
- **Fresh blockhash**: signer-mcp must use a current blockhash to mitigate replay risk
- **Deterministic summary**: the approval summary fields must be fixed values — never
  ranges, estimates marked as uncertain, or "TBD" placeholders

---

## MCP Configuration Reference

```json
{
  "orquestra": {
    "type": "remote",
    "url": "https://api.orquestra.dev/mcp"
  },
  "signer-mcp": {
    "type": "local",
    "command": ["npx", "@orquestradev/signer-mcp@latest"]
  }
}
```

Environment variables required by signer-mcp:
- `SIGNER_KEYPAIR` — base58-encoded or JSON array keypair for the signing wallet
- `SOLANA_RPC_URL` — RPC endpoint (e.g. `https://api.mainnet-beta.solana.com`)
