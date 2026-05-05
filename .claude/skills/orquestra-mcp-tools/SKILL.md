---
name: orquestra-mcp-tools
description: |
  Complete reference for all 8 Orquestra MCP tools — parameters, return shapes,
  and usage examples. Use when calling any Orquestra MCP tool directly, debugging
  tool responses, or understanding what inputs each tool requires.
  Triggers: "orquestra tool", "search_programs", "list_instructions", "build_instruction",
  "list_pda_accounts", "derive_pda", "read_llms_txt", "get_ai_analysis",
  "simulate_instruction", "mcp tool params", "what does this tool return",
  "tool not working", "tool input schema", "orquestra api tool".
---

# Orquestra MCP — Tool Reference

MCP server: `https://api.orquestra.dev/mcp`

All tools accept and return JSON. `projectId` is the Orquestra internal ID returned
by `search_programs` (NOT the Solana program address).

---

## 1. `search_programs`

Find Solana programs by name, keyword, or on-chain program ID.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | ✅ | Program name, keyword, or base58 program address |
| `limit` | number | ❌ | Max results (default: 10) |

**Example**
```
search_programs({ query: "marinade" })
search_programs({ query: "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB" })
```

**Returns** — list of matches, each with:
- `id` — Orquestra projectId (use this in all other tools)
- `name` — program name
- `program_id` — on-chain Solana address
- `description` — protocol summary

---

## 2. `list_instructions`

List all instructions a program exposes — names, arguments, and required accounts.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectId` | string | ✅ | Orquestra project ID from `search_programs` |

**Returns** — Markdown table per instruction:
- Instruction name
- Args: `name`, type
- Accounts: `name`, writable flag, signer flag

---

## 3. `build_instruction`

Build an unsigned Solana transaction. Returns base64-encoded wire transaction.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectId` | string | ✅ | Orquestra project ID |
| `instructionName` | string | ✅ | Exact instruction name (case-sensitive) |
| `accounts` | object | ✅ | Map of `accountName → base58 pubkey` |
| `args` | object | ✅ | Map of `argName → value` (types must match IDL) |
| `feePayer` | string | ✅ | Base58 pubkey of fee payer wallet |
| `network` | string | ❌ | `"mainnet-beta"` (default) \| `"devnet"` |

**Returns**
- `transaction` — base64-encoded unsigned wire transaction
- `riskLevel` — `"LOW"` \| `"MEDIUM"` \| `"HIGH"`
- `riskReasons` — string[] explaining the risk
- `estimatedFee` — lamports
- `accounts` — resolved account list with pubkeys + flags

**Errors**
- Missing required account → error names the exact missing field
- Wrong arg type → error names field + expected type
- Program not found → use `search_programs` first

---

## 4. `simulate_instruction`

Preflight a transaction against the Solana RPC. Decodes Anchor errors. Never signs.

**Inputs** — same as `build_instruction` (projectId, instructionName, accounts, args, feePayer, network)

**Returns**
- `success` — boolean
- `computeUnitsConsumed` — number
- `decodedError` — `{ name, code, msg }` if Anchor error found
- `logs` — last RPC log lines
- `err` — raw RPC error on failure

**When to use**: always run between `build_instruction` and signing. Catches wrong
accounts, missing seeds, and logic errors before touching the wallet.

---

## 5. `list_pda_accounts`

List all PDA-derivable account types for a program and their seed schemas.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectId` | string | ✅ | Orquestra project ID |

**Returns** — per PDA account:
- Account type name
- Seeds: `name`, `kind` (`const` \| `account` \| `arg`), `type`

---

## 6. `derive_pda`

Derive the address of a PDA from its seeds.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectId` | string | ✅ | Orquestra project ID |
| `accountType` | string | ✅ | Account type name from `list_pda_accounts` |
| `seeds` | object | ✅ | Map of `seedName → value` (pubkey strings, numbers, etc.) |
| `network` | string | ❌ | `"mainnet-beta"` \| `"devnet"` |

**Returns**
- `address` — derived base58 PDA address
- `bump` — canonical bump seed (0–255)

---

## 7. `read_llms_txt`

Fetch the full AI-optimized Markdown documentation for a program.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectId` | string | ✅ | Orquestra project ID |

**Returns** — full Markdown document structured for LLM context windows:
- Instruction tables (name, args, accounts)
- Account type descriptions
- Error code reference

Use this to ground any AI with accurate program context before building transactions.

---

## 8. `get_ai_analysis`

Fetch Orquestra's AI-generated analysis of a Solana program.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectId` | string | ✅ | Orquestra project ID |

**Returns**
- Protocol description
- Category tags
- Risk notes
- Usage statistics (if available)

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Passing Solana program address as `projectId` | Use `search_programs` first — `projectId` ≠ program address |
| Guessing instruction name | Use `list_instructions` — names are case-sensitive |
| Missing account in `build_instruction` | Use `list_pda_accounts` + `derive_pda` to resolve |
| `simulate_instruction` fails with Anchor error | Read `decodedError.msg` — it names the exact constraint violation |
| Wrong arg type (e.g. string instead of u64) | Check IDL type from `list_instructions` |
