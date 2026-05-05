#!/usr/bin/env bash
# Orquestra Claude Agents + Skills Installer
#
# Installs:
#   - 6 sub-agents   → .claude/agents/             (Solana task pipeline, Claude Code)
#   - 3 skills       → .claude/skills/             (MCP reference, Claude Code)
#   - MCP server     → Claude Desktop config       (--claude-desktop flag)
#
# Usage:
#   ./install-skills.sh                     # project-level agents + skills
#   ./install-skills.sh --global            # global agents + skills (~/.claude/)
#   ./install-skills.sh --claude-desktop    # patch Claude Desktop MCP config
#   ./install-skills.sh --global --claude-desktop  # all of the above
#   bash <(curl -fsSL https://raw.githubusercontent.com/berkayoztunc/orquestra/main/install-skills.sh)
#
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/berkayoztunc/orquestra/main"

GLOBAL=false
CLAUDE_DESKTOP=false

for arg in "$@"; do
  case "$arg" in
    --global)          GLOBAL=true ;;
    --claude-desktop)  CLAUDE_DESKTOP=true ;;
    --help|-h)
      echo "Usage: $0 [--global] [--claude-desktop]"
      echo "  --global          Install agents+skills to ~/.claude/ (all projects)"
      echo "  --claude-desktop  Patch Claude Desktop MCP config (macOS)"
      echo "  default           Install to .claude/ in current directory"
      exit 0 ;;
  esac
done

if $GLOBAL; then
  BASE_DIR="$HOME/.claude"
else
  BASE_DIR="$(pwd)/.claude"
fi

AGENTS_DIR="$BASE_DIR/agents"
SKILLS_DIR="$BASE_DIR/skills"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
info() { echo -e "${YELLOW}→${RESET} $*"; }
err()  { echo -e "${RED}✗${RESET} $*" >&2; }

# ── Agents ─────────────────────────────────────────────────────────────────
AGENTS=(
  orquestra
  orquestra-researcher
  orquestra-pda-explorer
  orquestra-tx-builder
  orquestra-simulator
  orquestra-signer
)

# ── Skills ──────────────────────────────────────────────────────────────────
SKILLS=(
  orquestra-mcp-connect
  orquestra-mcp-tools
  orquestra-solana
)

echo ""
echo "Orquestra Claude Agents + Skills Installer"
echo "Target: $BASE_DIR"
echo ""

# ── Install agents ──────────────────────────────────────────────────────────
mkdir -p "$AGENTS_DIR"
info "Installing agents → $AGENTS_DIR"

for agent in "${AGENTS[@]}"; do
  url="$REPO_RAW/.claude/agents/${agent}.md"
  dest="$AGENTS_DIR/${agent}.md"
  if curl -fsSL --max-time 10 "$url" -o "$dest" 2>/dev/null; then
    ok "  agent: $agent"
  else
    err "  agent: $agent (fetch failed)"
  fi
done

# ── Install skills ───────────────────────────────────────────────────────────
echo ""
info "Installing skills → $SKILLS_DIR"

for skill in "${SKILLS[@]}"; do
  skill_dir="$SKILLS_DIR/$skill"
  mkdir -p "$skill_dir"
  url="$REPO_RAW/.claude/skills/${skill}/SKILL.md"
  dest="$skill_dir/SKILL.md"
  if curl -fsSL --max-time 10 "$url" -o "$dest" 2>/dev/null; then
    ok "  skill: $skill"
  else
    err "  skill: $skill (fetch failed)"
  fi
done

# ── Patch Claude Desktop config ─────────────────────────────────────────────
if $CLAUDE_DESKTOP; then
  echo ""
  info "Patching Claude Desktop config..."

  DESKTOP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

  if [[ ! -f "$DESKTOP_CONFIG" ]]; then
    err "Claude Desktop config not found: $DESKTOP_CONFIG"
    err "Install Claude Desktop first: https://claude.ai/download"
  else
    # Check if orquestra already present
    if python3 -c "import json,sys; d=json.load(open('$DESKTOP_CONFIG')); exit(0 if 'orquestra' in d.get('mcpServers',{}) else 1)" 2>/dev/null; then
      ok "  orquestra MCP already in Claude Desktop config"
    else
      # Inject orquestra MCP server using python3 (safe JSON merge)
      python3 - "$DESKTOP_CONFIG" << 'PYEOF'
import json, sys

path = sys.argv[1]
with open(path, 'r') as f:
    config = json.load(f)

config.setdefault('mcpServers', {})['orquestra'] = {
    "command": "npx",
    "args": [
        "-y",
        "@modelcontextprotocol/client-streamable-http",
        "https://api.orquestra.dev/mcp"
    ]
}

with open(path, 'w') as f:
    json.dump(config, f, indent=2)

print("patched")
PYEOF
      ok "  orquestra MCP added to Claude Desktop"
      info "  Restart Claude Desktop to load the new MCP server"
    fi
  fi
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
ok "Done! ${#AGENTS[@]} agents + ${#SKILLS[@]} skills installed."
echo ""
info "Agents (Claude Code):  /orquestra → researcher → pda-explorer → tx-builder → simulator → signer"
info "Skills (Claude Code):  /orquestra-mcp-connect  /orquestra-mcp-tools  /orquestra-solana"
echo ""
if $CLAUDE_DESKTOP; then
  info "Claude Desktop: orquestra MCP tools now available (restart required)"
  info "  Tools: search_programs, list_instructions, build_instruction,"
  info "         list_pda_accounts, derive_pda, read_llms_txt,"
  info "         get_ai_analysis, simulate_instruction"
else
  info "To also patch Claude Desktop:  $0 --claude-desktop"
fi
echo ""
