#!/usr/bin/env bash
# Orquestra Claude Agents + Skills Installer
#
# Installs:
#   - 6 sub-agents → .claude/agents/   (Solana task pipeline)
#   - 3 skills     → .claude/skills/   (MCP usage reference)
#
# Usage:
#   ./install-skills.sh                # install to current project
#   ./install-skills.sh --global       # install to ~/.claude/ (all projects)
#   bash <(curl -fsSL https://raw.githubusercontent.com/berkayoztunc/orquestra/main/install-skills.sh)
#
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/berkayoztunc/orquestra/main"

GLOBAL=false
for arg in "$@"; do
  case "$arg" in
    --global) GLOBAL=true ;;
    --help|-h)
      echo "Usage: $0 [--global]"
      echo "  --global  Install to ~/.claude/ (all projects)"
      echo "  default   Install to .claude/ (current project only)"
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

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
info() { echo -e "${YELLOW}→${RESET} $*"; }
err()  { echo -e "\033[0;31m✗\033[0m $*" >&2; }

# ── Agents (pipeline sub-agents) ───────────────────────────────────────────
AGENTS=(
  orquestra
  orquestra-researcher
  orquestra-pda-explorer
  orquestra-tx-builder
  orquestra-simulator
  orquestra-signer
)

# ── Skills (MCP + Solana usage reference) ──────────────────────────────────
SKILLS=(
  orquestra-mcp-connect
  orquestra-mcp-tools
  orquestra-solana
)

# ── Install agents ─────────────────────────────────────────────────────────
echo ""
echo "Orquestra Claude Agents + Skills Installer"
echo "Target: $BASE_DIR"
echo ""

mkdir -p "$AGENTS_DIR"
info "Installing agents → $AGENTS_DIR"

for agent in "${AGENTS[@]}"; do
  url="$REPO_RAW/.claude/agents/${agent}.md"
  dest="$AGENTS_DIR/${agent}.md"
  if curl -fsSL --max-time 10 "$url" -o "$dest" 2>/dev/null; then
    ok "  agent: $agent"
  else
    err "  agent: $agent (fetch failed — check network or repo URL)"
  fi
done

# ── Install skills ─────────────────────────────────────────────────────────
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
    err "  skill: $skill (fetch failed — check network or repo URL)"
  fi
done

echo ""
ok "Done! ${#AGENTS[@]} agents + ${#SKILLS[@]} skills installed."
echo ""
info "Agents:   /orquestra (orchestrator)"
info "          orquestra-researcher → pda-explorer → tx-builder → simulator → signer"
echo ""
info "Skills:   /orquestra-mcp-connect  — MCP setup for Claude Desktop / Cursor"
info "          /orquestra-mcp-tools    — all 8 MCP tool params + examples"
info "          /orquestra-solana       — full pipeline guide for Solana tasks"
echo ""
info "Usage: 'Stake 2 SOL with Marinade'  →  orquestra orchestrates full pipeline"
info "Usage: /orquestra-mcp-tools         →  quick reference for any MCP tool"
echo ""
