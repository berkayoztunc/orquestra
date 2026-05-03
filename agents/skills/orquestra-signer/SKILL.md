---
name: orquestra-signer
description: "Use when you have an unsigned base64 wire Solana transaction and need to sign and/or send it using @orquestradev/signer-mcp. Use when a user says 'sign transaction', 'sign and send', 'submit this tx', 'send the transaction', 'sign this base64', 'what\'s my wallet address', or 'broadcast transaction'. ALWAYS show an approval summary and require explicit YES before signing."
argument-hint: "Base64-encoded wire transaction string, and target network (mainnet-beta or devnet)."
---

# Orquestra Signer

Signing and submission skill. Uses ONLY `@orquestradev/signer-mcp` tools.
This skill is the FINAL step in the pipeline — it never builds or researches.

## Constraints

- ONLY use signer-mcp tools: `get_signer_address`, `sign_transaction`,
  `sign_and_send_transaction`
- NEVER sign without displaying the approval summary first
- NEVER sign without receiving an explicit YES from the user
- NEVER modify the transaction content
- NEVER build or research — this skill receives a ready-made base64 wire tx
- ALWAYS pass `encoding: "base64"` in every signing tool call

## Setup Requirements

The signer-mcp server requires these environment variables:
```
SIGNER_KEYPAIR=<base58-encoded-or-JSON-array-keypair>
SOLANA_RPC_URL=<rpc-endpoint>
```

## Signing Protocol (execute every single time)

### Step 1 — Identify signing wallet
Call `get_signer_address` and display:
```
Signing Wallet: <pubkey>
```

### Step 2 — Show approval summary (MANDATORY)
```
═══════════════════════════════════════════
  TRANSACTION APPROVAL REQUIRED
═══════════════════════════════════════════
  Network:        <mainnet-beta / devnet>
  Signer Wallet:  <pubkey>
  Program:        <program name or ID>
  Instruction:    <instruction name>
  Fee Payer:      <pubkey>
  Estimated Fee:  <lamports> (~$X USD)
  Action:         <plain English description>
  Risk Level:     LOW / MEDIUM / HIGH
═══════════════════════════════════════════
  Type YES to sign and send, or NO to cancel.
═══════════════════════════════════════════
```

### Step 3 — Wait for explicit approval
- YES → proceed to Step 4
- NO / cancel → stop, do not call any signing tool
- Ambiguous → ask again, do not assume

### Step 4 — Sign (and optionally send)
- **Sign only**: call `sign_transaction` with `encoding: "base64"` → return signed base64 wire tx for review
- **Sign and send**: call `sign_and_send_transaction` with `encoding: "base64"` → return signature

> Both tools must receive `encoding: "base64"` in the request payload.

### Step 5 — Confirmation
```
Transaction Signature: <base58_signature>
Explorer: https://explorer.solana.com/tx/<signature>?cluster=<network>
```

## Risk Level Guide

| Level | Condition |
|-------|-----------|
| LOW | Read-only or account creation, no token transfer |
| MEDIUM | Token transfer < 1 SOL equivalent |
| HIGH | Token transfer > 1 SOL, swap, stake, or program upgrade |
