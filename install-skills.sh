#!/usr/bin/env bash
# Orquestra Claude Skills Installer
#
# Usage:
#   ./scripts/install-skills.sh              # install to project (.claude/skills/)
#   ./scripts/install-skills.sh --global     # install to ~/.claude/skills/
#   bash <(curl -fsSL https://raw.githubusercontent.com/berkayoztunc/orquestra/main/scripts/install-skills.sh)
#
set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────
REPO_RAW="https://raw.githubusercontent.com/berkayoztunc/orquestra/main"
GLOBAL=false

for arg in "$@"; do
  case "$arg" in
    --global) GLOBAL=true ;;
    --help|-h)
      echo "Usage: $0 [--global]"
      echo "  --global  Install to ~/.claude/skills/ (available in all projects)"
      echo "  default   Install to .claude/skills/ (this project only)"
      exit 0 ;;
  esac
done

if $GLOBAL; then
  SKILLS_DIR="$HOME/.claude/skills"
else
  # Find project root (where .claude/ lives or should live)
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
  SKILLS_DIR="$PROJECT_ROOT/.claude/skills"
fi

# ── Helpers ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
info() { echo -e "${YELLOW}→${RESET} $*"; }

install_skill() {
  local name="$1"
  local skill_dir="$SKILLS_DIR/$name"
  mkdir -p "$skill_dir"

  # Try fetching from GitHub first; fall back to inline content if offline
  local url="$REPO_RAW/.claude/skills/$name/SKILL.md"
  if curl -fsSL --max-time 5 "$url" -o "$skill_dir/SKILL.md" 2>/dev/null; then
    ok "Installed '$name' from GitHub"
  else
    # Write inline fallback (defined per-skill below)
    "write_${name//-/_}_skill" "$skill_dir"
    ok "Installed '$name' (inline)"
  fi
}

# ── Inline skill definitions (fallback + source of truth) ──────────────────

write_orquestra_api_skill() {
  local dir="$1"
  cat > "$dir/SKILL.md" << 'SKILL'
---
name: orquestra-api
description: |
  Orquestra REST API helper. Use when working with Orquestra API endpoints,
  building transactions, deriving PDAs, or debugging API responses.
  Triggers: "call orquestra api", "build transaction", "derive pda",
  "api endpoint", "orquestra endpoint", "test the api", "api key",
  "build instruction", "post to orquestra", "orquestra request".
---

# Orquestra API

Base URL: `https://api.orquestra.dev`

## Key Endpoints

| Action | Method | Path |
|--------|--------|------|
| Build instruction | POST | `/api/:projectId/instructions/:instruction/build` |
| Derive PDA | GET | `/api/:projectId/pda` |
| List instructions | GET | `/api/:projectId/instructions` |
| Get project | GET | `/api/:projectId` |

## Build Transaction (example)

```bash
curl -X POST https://api.orquestra.dev/api/PROJECT_ID/instructions/INSTRUCTION_NAME/build \
  -H "Content-Type: application/json" \
  -d '{
    "accounts": { "key": "pubkey..." },
    "args": { "amount": 1000000 },
    "feePayer": "WALLET_PUBKEY"
  }'
```

Response: `{ "transaction": "<base58>" }`

## Auth

API key via header: `X-API-Key: orq_live_xxxx`
Or OAuth via GitHub at `/auth/github`.

## Local Dev

Frontend: `http://localhost:5173`
Backend API: `http://localhost:3000`
SKILL
}

write_orquestra_dev_skill() {
  local dir="$1"
  cat > "$dir/SKILL.md" << 'SKILL'
---
name: orquestra-dev
description: |
  Orquestra full-stack development guide. Use when working on the monorepo,
  running dev servers, debugging build issues, or navigating the codebase.
  Triggers: "run dev", "start server", "build project", "monorepo",
  "frontend", "backend", "orquestra stack", "how to run", "dev setup",
  "packages structure", "where is", "project structure".
---

# Orquestra Dev Guide

## Monorepo Structure

```
packages/
  frontend/     React + Vite + Tailwind (port 5173)
  backend/      Node.js API server (port 3000)
  mcp/          MCP server (Orquestra tools for Claude)
scripts/
  install-skills.sh   Install Claude skills for this project
```

## Run Dev

```bash
# All packages
pnpm dev

# Individual
pnpm --filter frontend dev
pnpm --filter backend dev
```

## Key Files

- `packages/frontend/src/pages/Home.tsx` — landing page
- `packages/frontend/src/components/TryItPanel.tsx` — live demo widget
- `packages/backend/src/routes/` — API route handlers
- `packages/mcp/src/index.ts` — MCP tool definitions

## Tech Stack

- Frontend: React 18, React Router, Tailwind CSS, Vite
- Backend: Node.js, Express (or equivalent)
- MCP: `@modelcontextprotocol/sdk`
- Monorepo: pnpm workspaces

## Conventions

- Tailwind utility classes — no CSS modules
- `surface-elevated`, `surface-card`, `dark-900` design tokens
- `btn-primary`, `btn-secondary` button variants
- `gradient-text` for accent headings
SKILL
}

write_orquestra_mcp_skill() {
  local dir="$1"
  cat > "$dir/SKILL.md" << 'SKILL'
---
name: orquestra-mcp
description: |
  Orquestra MCP server development and debugging. Use when building new MCP tools,
  debugging tool calls, or working with the Orquestra MCP endpoint.
  Triggers: "mcp tool", "mcp server", "add tool", "mcp endpoint", "tool schema",
  "build_instruction", "search_programs", "derive_pda", "simulate_instruction",
  "mcp config", "claude desktop config", "connect agent".
---

# Orquestra MCP

Endpoint: `https://api.orquestra.dev/mcp` (streamable HTTP)

## Claude Desktop Config

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

## Available Tools

| Tool | Description |
|------|-------------|
| `search_programs` | Find Solana programs by name/address/category |
| `list_instructions` | List all instructions for a program |
| `build_instruction` | Build a base58 transaction |
| `derive_pda` | Derive program-derived addresses |
| `fetch_pda_data` | Read on-chain account data |
| `simulate_instruction` | Preflight a transaction without signing |
| `get_ai_analysis` | AI summary of a Solana program |
| `read_llms_txt` | Fetch LLM-optimized docs for a program |

## Adding a New Tool (backend)

1. Define tool schema in `packages/mcp/src/tools/`
2. Implement handler — return `{ content: [{ type: "text", text: "..." }] }`
3. Register in `packages/mcp/src/index.ts`
4. Test: `claude --mcp-config mcp-local.json "call my new tool"`

## Debugging

```bash
# Check what tools are registered
curl https://api.orquestra.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```
SKILL
}

# ── Skills to install ──────────────────────────────────────────────────────
SKILLS=(
  orquestra-api
  orquestra-dev
  orquestra-mcp
)

# ── Main ───────────────────────────────────────────────────────────────────
echo ""
echo "Orquestra Claude Skills Installer"
echo "Installing to: $SKILLS_DIR"
echo ""

mkdir -p "$SKILLS_DIR"

for skill in "${SKILLS[@]}"; do
  install_skill "$skill"
done

echo ""
ok "Done! $((${#SKILLS[@]})) skill(s) installed."
echo ""
info "In Claude Code, use skills with /orquestra-api, /orquestra-dev, /orquestra-mcp"
info "Or Claude will auto-trigger them based on what you're working on."
echo ""
