---
name: orquestra-conductor
description: "Top-level conductor skill that routes Solana tasks across four specialized sub-skills: orquestra-researcher (program discovery), orquestra-pda-explorer (account resolution), orquestra-tx-builder (transaction construction), and orquestra-signer (sign + send via @orquestradev/signer-mcp). Use when a user says 'build a transaction', 'orquestra', 'derive PDA', 'build instruction', 'unsigned tx', 'Solana transaction', 'sign and send', 'fill accounts', or 'Orquestra Conductor'."
argument-hint: "Describe the Solana action (program + instruction if known), network, wallet/authority, and any known accounts."
---

# Orquestra Conductor

Full Solana transaction pipeline conductor. Routes tasks to four specialized sub-skills,
each owning a distinct phase. Uses Orquestra MCP for research/building and
`@orquestradev/signer-mcp` for signing.

## Sub-Skills

| Skill | Phase | MCP | Trigger |
|-------|-------|-----|---------|
| `orquestra-researcher` | 1 — Discovery | Orquestra | program name/keyword |
| `orquestra-pda-explorer` | 2 — Account Resolution | Orquestra | missing accounts/PDAs |
| `orquestra-tx-builder` | 3 — Construction | Orquestra | all accounts resolved |
| `orquestra-signer` | 4 — Sign & Send | signer-mcp | base64 tx ready |

## Pipeline

```
User intent
    │
    ▼
[1] orquestra-researcher   →  program ID, instruction name, account schemas
    │
    ▼
[2] orquestra-pda-explorer →  all account addresses resolved
    │
    ▼
[3] orquestra-tx-builder   →  base64 unsigned transaction
    │
    ▼
[4] orquestra-signer       →  tx signature + explorer link
```

Skip stages that are already satisfied by the user's input.

---

## Conductor Constraints

- ONLY use Orquestra MCP tools in stages 1–3
- ONLY use signer-mcp tools in stage 4
- DO NOT invent account addresses, signer authorities, PDA seed values, or argument values
- DO NOT assume PDA seeds — if a required seed is missing, ask for that exact seed
- DO NOT proceed to the next stage if current stage has unresolved required inputs
- DO NOT sign or send without showing an approval summary and receiving explicit YES

## Solana Base Program IDs (all stages)

| Program | Address |
|---------|---------|
| System Program | `11111111111111111111111111111111` |
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| ATA Program | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |
| Memo | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| Sysvar Rent | `SysvarRent111111111111111111111111111111111` |
| Sysvar Clock | `SysvarC1ock11111111111111111111111111111111` |

## Detailed Skill Specs

See the individual skill files for full procedures, output formats, and constraints:

- [agents/skills/orquestra-researcher/SKILL.md](agents/skills/orquestra-researcher/SKILL.md)
- [agents/skills/orquestra-pda-explorer/SKILL.md](agents/skills/orquestra-pda-explorer/SKILL.md)
- [agents/skills/orquestra-tx-builder/SKILL.md](agents/skills/orquestra-tx-builder/SKILL.md)
- [agents/skills/orquestra-signer/SKILL.md](agents/skills/orquestra-signer/SKILL.md)

## MCP Configuration

```json
{
  "orquestra": { "type": "remote", "url": "https://api.orquestra.dev/mcp" },
  "signer-mcp": { "type": "local", "command": ["npx", "@orquestradev/signer-mcp@latest"] }
}
```
# Sign progress 
check signer-mcp is installed and environment variables are set. If not skip to sign progress. and ask the user for next steps.

Environment variables for `signer-mcp`:
- `SIGNER_KEYPAIR` — base58 or JSON array keypair
- `SOLANA_RPC_URL` — e.g. `https://api.mainnet-beta.solana.com`

## Optional CLI Utility *(show only when asked)*

```bash
orquestra --help
orquestra sign <BASE58_TX>
orquestra decode <BASE58_TX>
```
