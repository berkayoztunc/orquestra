---
name: orquestra-tx-builder
description: "Use when all accounts and arguments are resolved and you need to construct an unsigned Solana transaction via Orquestra MCP. Use when a user says 'build transaction', 'build instruction', 'create unsigned tx', 'construct the transaction', 'build the swap', 'build the stake instruction', or 'generate base64 transaction'."
argument-hint: "Program ID, instruction name, all resolved account addresses (with signer/writable flags), all instruction arguments, and fee payer pubkey."
---

# Orquestra TX Builder

Transaction construction skill. Uses ONLY Orquestra MCP's `build_instruction` tool
to produce a base64-encoded wire transaction (Solana RPC standard, `encoding: "base64"`).

## Constraints

- ONLY use Orquestra MCP tool: `build_instruction`
- DO NOT call `build_instruction` with placeholder or guessed values
- DO NOT search programs or derive PDAs — use upstream research results
- DO NOT sign or send — hand off to `orquestra-signer`

## Pre-Build Checklist

All items must be confirmed before calling `build_instruction`:

- [ ] `program_id` — exact base58 program address
- [ ] `instruction_name` — exact instruction name from Orquestra
- [ ] All **required accounts** — base58 addresses with signer/writable flags
- [ ] All **required arguments** — values with correct types (u64, Pubkey, etc.)
- [ ] `fee_payer` — wallet pubkey that pays the transaction fee

If ANY item is missing:
- Missing account → ask user to run `orquestra-pda-explorer` first, or ask for exact address
- Missing argument → ask for the argument name and its expected type
- NEVER proceed with unknowns

## Output Format

**Pre-Build Summary**
```
Program:      <name> (<program_id>)
Instruction:  <instruction_name>
Fee Payer:    <pubkey>

Accounts:
  [0] authority   <pubkey>  signer=true  writable=false
  [1] vault        <pubkey>  signer=false writable=true

Arguments:
  amount: 1500000000  (u64, lamports)
```

**Unsigned Transaction (base64 wire format)**
```
Encoding:  base64
Wire TX:   <base64_encoded_wire_tx>
```

> Solana wire-format transaction serialized as base64.
> Submit to RPC with `encoding: "base64"` in the request body.

**RPC submission header (for manual use)**
```http
Content-Type: application/json
```
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "sendTransaction",
  "params": [
    "<base64_encoded_wire_tx>",
    { "encoding": "base64", "preflightCommitment": "confirmed" }
  ]
}
```

**Next Step**
"Pass this base64 wire transaction to `orquestra-signer` to sign and send."
