---
name: orquestra-mcp-connect
description: |
  Connect the Orquestra MCP server to Claude Code, Claude Desktop, OpenAI Codex CLI,
  or Cursor. Use when setting up Orquestra MCP for the first time, troubleshooting
  connection issues, or configuring a new client.
  Triggers: "connect orquestra", "mcp config", "claude desktop config", "cursor mcp",
  "how to add mcp", "orquestra mcp setup", "mcp not connecting", "add orquestra to claude",
  "mcp server config", "configure mcp", "install orquestra mcp", "mcp endpoint",
  "codex mcp", "codex cli mcp", "openai codex mcp".
---

# Orquestra MCP — Connection Setup

MCP endpoint: `https://api.orquestra.dev/mcp` (Streamable HTTP, stateless)

---

## Quick Install (all clients)

```bash
# curl
bash <(curl -fsSL https://raw.githubusercontent.com/berkayoztunc/orquestra/main/install-skills.sh) --all

# wget
bash <(wget -qO- https://raw.githubusercontent.com/berkayoztunc/orquestra/main/install-skills.sh) --all
```

Installs agents + skills for Claude Code, then patches MCP config for Claude Code,
Claude Desktop, and OpenAI Codex CLI.

**Selective flags:**

| Flag | Effect |
|------|--------|
| *(none)* | Agents + skills only (local `.claude/`) |
| `--global` | Agents + skills to `~/.claude/` |
| `--claude-code` | Patch Claude Code `settings.json` |
| `--claude-desktop` | Patch Claude Desktop config |
| `--codex` | Patch Codex CLI `~/.codex/config.toml` |
| `--all` | Global install + all three MCP patches |

---

## Manual Config

### Claude Code (CLI)

```bash
claude mcp add orquestra --transport http https://api.orquestra.dev/mcp
```

Or edit `.claude/settings.json` directly:

```json
{
  "mcpServers": {
    "orquestra": {
      "type": "http",
      "url": "https://api.orquestra.dev/mcp"
    }
  }
}
```

### Claude Desktop

File: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "orquestra": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/client-streamable-http",
        "https://api.orquestra.dev/mcp"
      ]
    }
  }
}
```

Restart Claude Desktop after saving.

### OpenAI Codex CLI

File: `~/.codex/config.toml`

```toml
[[mcp_servers]]
name = "orquestra"
url = "https://api.orquestra.dev/mcp"
```

### Cursor

File: `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global)

```json
{
  "mcpServers": {
    "orquestra": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/client-streamable-http",
        "https://api.orquestra.dev/mcp"
      ]
    }
  }
}
```

---

## Verify Connection

After connecting, ask your AI assistant:

> "List the tools available in the orquestra MCP server"

You should see 8 tools: `search_programs`, `list_instructions`, `build_instruction`,
`list_pda_accounts`, `derive_pda`, `read_llms_txt`, `get_ai_analysis`, `simulate_instruction`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Tools not appearing | Restart the client after config change |
| `npx` not found | Install Node.js ≥ 18 |
| Connection refused | Check internet access to `api.orquestra.dev` |
| `search_programs` returns empty | Program not indexed — upload IDL at orquestra.dev |
| Wrong tool name format | Use underscores: `search_programs`, not `searchPrograms` |
| Codex not picking up config | Restart Codex CLI; check `~/.codex/config.toml` syntax |

---

## Agent Pipeline (Claude Code only)

Full Solana transaction pipeline — researcher → builder → signer:

```bash
# curl
bash <(curl -fsSL https://raw.githubusercontent.com/berkayoztunc/orquestra/main/install-skills.sh)

# wget
bash <(wget -qO- https://raw.githubusercontent.com/berkayoztunc/orquestra/main/install-skills.sh)
```

Agents: `orquestra`, `orquestra-researcher`, `orquestra-pda-explorer`,
`orquestra-tx-builder`, `orquestra-simulator`, `orquestra-signer`
