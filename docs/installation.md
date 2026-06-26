# Orquestra — Installation Guide

Orquestra exposes a Streamable HTTP MCP server at `https://api.orquestra.dev/mcp` with 8 Solana tools.
This guide covers connecting it to Claude Code, Claude Desktop, and OpenAI Codex CLI.

---

## Quick Install

One command installs everything:

```bash
# curl
bash <(curl -fsSL https://raw.githubusercontent.com/berkayoztunc/orquestra/main/install-skills.sh) --all

# wget
bash <(wget -qO- https://raw.githubusercontent.com/berkayoztunc/orquestra/main/install-skills.sh) --all
```

`--all` installs agents + skills globally (`~/.claude/`) and patches MCP config for all three clients.

### Selective flags

| Flag | What it does |
|------|--------------|
| *(none)* | Agents + skills → local `.claude/` |
| `--global` | Agents + skills → `~/.claude/` (all projects) |
| `--claude-code` | Patch Claude Code `settings.json` |
| `--claude-desktop` | Patch Claude Desktop config |
| `--codex` | Patch Codex CLI `~/.codex/config.toml` |
| `--all` | `--global` + all three MCP patches |

Examples:

```bash
# agents/skills only, local
./install-skills.sh

# agents/skills + Claude Desktop patch
./install-skills.sh --claude-desktop

# remote, everything (curl)
bash <(curl -fsSL https://raw.githubusercontent.com/berkayoztunc/orquestra/main/install-skills.sh) --all

# remote, everything (wget)
bash <(wget -qO- https://raw.githubusercontent.com/berkayoztunc/orquestra/main/install-skills.sh) --all
```

---

## What Gets Installed

### Agents (Claude Code sub-agents)

| Agent | Role |
|-------|------|
| `orquestra` | Orchestrator — routes tasks to sub-agents |
| `orquestra-researcher` | Program discovery, IDL + docs reading |
| `orquestra-pda-explorer` | PDA derivation and on-chain account resolution |
| `orquestra-tx-builder` | Unsigned transaction construction |
| `orquestra-simulator` | Preflight simulation, Anchor error decoding |
| `orquestra-signer` | Sign + send via signer MCP |

Installed to: `.claude/agents/` (local) or `~/.claude/agents/` (global)

### Skills (Claude Code slash commands)

| Skill | Trigger |
|-------|---------|
| `orquestra-mcp-connect` | `/orquestra-mcp-connect` — MCP setup guide |
| `orquestra-mcp-tools` | `/orquestra-mcp-tools` — tool parameter reference |
| `orquestra-solana` | `/orquestra-solana` — end-to-end Solana pipeline |

Installed to: `.claude/skills/` (local) or `~/.claude/skills/` (global)

---

## Manual Configuration

### Claude Code

**Via CLI:**
```bash
claude mcp add orquestra --transport http https://api.orquestra.dev/mcp
```

**Via config file** (`.claude/settings.json`):
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

**Prerequisite:** Node.js ≥ 18 (`node --version`)

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

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `search_programs` | Search indexed Solana programs by name/category |
| `list_instructions` | List all instructions for a program |
| `build_instruction` | Build an unsigned transaction for an instruction |
| `simulate_instruction` | Preflight simulate — decode Anchor errors |
| `list_pda_accounts` | List PDA account types for a program |
| `derive_pda` | Derive a PDA from seeds |
| `read_llms_txt` | Read program's llms.txt documentation |
| `get_ai_analysis` | AI-powered program summary |

---

## Verify Connection

After configuration, ask your AI:

> "List the tools available in the orquestra MCP server"

Should return all 8 tools above.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Tools not appearing | Restart the client after config change |
| `npx` not found | Install Node.js ≥ 18 |
| Connection refused | Check internet access to `api.orquestra.dev` |
| `search_programs` returns empty | Upload the program IDL at orquestra.dev |
| Wrong tool name format | Use underscores: `search_programs` not `searchPrograms` |
| Codex not picking up config | Restart Codex CLI; verify `~/.codex/config.toml` syntax |
| Claude Desktop shows old tools | Fully quit and reopen (Cmd+Q, not just close window) |
