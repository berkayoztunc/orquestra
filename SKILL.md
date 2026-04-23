---
name: orquestra-conductor
description: "Use when you want only Orquestra MCP + Orquestra CLI workflow: search program, read llms.txt, understand required accounts/arguments, iteratively derive PDAs, fetch PDA data to auto-fill missing accounts, and build unsigned transactions. Use when a user says 'build a transaction', 'orquestra', 'derive PDA', 'build instruction', 'unsigned tx', 'Solana transaction', 'fill accounts', or 'Orchestra Conductor'."
argument-hint: "Describe the Solana action (program + instruction if known), network, wallet/authority, and any known accounts."
---

# Orquestra Conductor

Orquestra-only transaction research and build workflow. Uses only Orquestra MCP + Orquestra CLI utility patterns to search programs, read docs, derive PDAs, and build unsigned transactions.

## Constraints

- ONLY use Orquestra MCP tools: `search_programs`, `read_llms_txt`, `list_instructions`, `list_pda_accounts`, `derive_pda`, `fetch_pda_data`, `build_instruction`
- Use terminal only for Orquestra CLI inspection and generic JSON-RPC helper calls
- DO NOT invent account addresses, signer authorities, PDA seed values, or argument values
- DO NOT assume PDA seeds — if a required seed is missing, ask for that exact seed
- DO NOT proceed with transaction building if required accounts or required args are unresolved
- DO NOT sign or send transactions

## Solana Base Program IDs

Use these constants when required by account lists:

| Program | Address |
|---------|---------|
| System Program | `11111111111111111111111111111111` |
| SPL Token (legacy) | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| SPL Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| Associated Token Program | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |
| Memo Program | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| Sysvar Rent | `SysvarRent111111111111111111111111111111111` |
| Sysvar Clock | `SysvarC1ock11111111111111111111111111111111` |

## Procedure

1. Parse user intent and extract likely program/instruction keywords
2. Call `search_programs` to find matching programs
3. Call `list_instructions` and `list_pda_accounts` to retrieve full requirements
4. Call `read_llms_txt` to understand account semantics and relationship hints
5. For each unresolved required account, run this loop:
   - Try `derive_pda` using known seeds
   - If derived, call `fetch_pda_data` on that PDA
   - Extract new pubkeys from returned fields and fill other missing accounts
   - Repeat until no new accounts are discovered or all required fields are complete
6. If unresolved fields remain, ask only for the exact missing values
7. Call `build_instruction` only when all required fields are satisfied

## Token Finder Utility (RPC Helpers)

When token account discovery is needed and not directly available from IDL context, run these JSON-RPC helper calls (user-supplied `$RPC_URL`):

**Get token accounts by owner:**
```bash
curl -s "$RPC_URL" -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"getTokenAccountsByOwner",
  "params":["<OWNER>",{"programId":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},{"encoding":"jsonParsed"}]
}'
```

**Get program accounts by mint:**
```bash
curl -s "$RPC_URL" -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"getProgramAccounts",
  "params":["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",{
    "encoding":"jsonParsed",
    "filters":[{"dataSize":165},{"memcmp":{"offset":0,"bytes":"<MINT>"}}]
  }]
}'
```

**Get account info:**
```bash
curl -s "$RPC_URL" -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"getAccountInfo",
  "params":["<TOKEN_ACCOUNT>",{"encoding":"jsonParsed"}]
}'
```

Use these only as helper discovery paths. Transaction building still uses Orquestra MCP.

## Missing Data Rules

- If multiple programs match, present top options and ask the user to choose before continuing
- If instruction name is unknown, propose best candidates with reasons
- If PDA derivation needs unknown seeds, ask only for exact seed values
- If required account addresses are missing, ask for exact account roles and addresses

## Output Format

Always respond in this order:

**1. Program Match**
- Selected program and why
- Chosen instruction

**2. Requirements**
- Required accounts and signer roles
- Required arguments and expected types
- Required PDA accounts and seed schema

**3. Filled Values**
- Accounts resolved so far
- Arguments resolved so far
- Any unresolved required inputs

**4. Next Input Needed**
- Exact missing fields the user must provide

**5. Unsigned Transaction**
- Provide only when all fields are complete
- Include base58 transaction string and a short validation note

**6. Optional Orquestra CLI Utility** *(show only when asked)*
- `orquestra --help`
- `orquestra sign <BASE58_TX>`
- `orquestra decode <BASE58_TX>`
