# Agent Skills

The `agents` directory defines Orquestra skill contracts for agentic Solana workflows.

## Skills

| Skill | Phase | MCP source | Purpose |
| --- | --- | --- | --- |
| `orquestra-researcher` | Discovery | Orquestra MCP | Find programs, read docs, list instructions, get AI analysis |
| `orquestra-pda-explorer` | Account resolution | Orquestra MCP | Derive PDAs and fetch decoded account data |
| `orquestra-tx-builder` | Construction | Orquestra MCP | Build unsigned transactions |
| `orquestra-simulator` | Preflight | Orquestra MCP | Simulate instructions and decode Anchor errors |
| `orquestra-signer` | Sign and send | `@orquestradev/signer-mcp` | Sign and submit after explicit approval |

## Install Claude Agents

Install the Orquestra sub-agents into the current project:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/berkayoztunc/orquestra/main/install-skills.sh)
```

Install them globally for all projects:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/berkayoztunc/orquestra/main/install-skills.sh) --global
```

The installer writes agent files under `.claude/agents/`.

## Pipeline

```text
researcher -> pda-explorer -> tx-builder -> simulator -> signer
```

Stages can be skipped when the user already provides exact project, instruction, accounts, args, and fee payer.

## Safety Rules

- Orquestra MCP builds and simulates; it does not sign.
- Signing must happen in the signer skill or another wallet client.
- Signing requires explicit user approval.
- Agents must not invent public keys, account addresses, seed values, or argument values.
- Each skill should only call tools in its phase.

## MCP Configuration

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

Signer MCP environment:

- `SIGNER_KEYPAIR`
- `SOLANA_RPC_URL`

See `agents/SKILLS.md` and `agents/SKILLS.policy.json` for the exact policy.
