#!/usr/bin/env bash
# Orquestra — Local Development
#
# Starts worker (port 8787) + frontend (port 5173) with local DB.
# Frontend proxy automatically routes /api → localhost:8787.
#
# Usage:
#   ./dev.sh              # start everything
#   ./dev.sh --stop       # stop all running dev servers
#   ./dev.sh --migrate    # apply pending local DB migrations first
#   ./dev.sh --seed       # apply migrations + seed dev data
#   ./dev.sh --reset      # reset local DB, migrate, seed, then start
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
info() { echo -e "${YELLOW}→${RESET} $*"; }
err()  { echo -e "${RED}✗${RESET} $*" >&2; }
head() { echo -e "${CYAN}$*${RESET}"; }

DO_MIGRATE=false
DO_SEED=false
DO_RESET=false

for arg in "$@"; do
  case "$arg" in
    --stop)
      info "Stopping Orquestra dev servers..."
      pkill -f "wrangler dev" 2>/dev/null && ok "Worker stopped" || info "Worker not running"
      pkill -f "vite --config vite.config.local" 2>/dev/null && ok "Frontend stopped" || info "Frontend not running"
      rm -f "$ROOT/packages/frontend/.env.local"
      exit 0 ;;
    --migrate) DO_MIGRATE=true ;;
    --seed)    DO_MIGRATE=true; DO_SEED=true ;;
    --reset)   DO_RESET=true; DO_MIGRATE=true; DO_SEED=true ;;
    --help|-h)
      echo ""
      echo "Orquestra dev server"
      echo ""
      echo "Usage: $0 [options]"
      echo ""
      echo "  (none)     Start worker + frontend"
      echo "  --migrate  Apply pending local DB migrations, then start"
      echo "  --seed     Migrate + seed dev data, then start"
      echo "  --reset    Reset DB + migrate + seed, then start"
      echo ""
      echo "URLs:"
      echo "  Frontend  http://localhost:5173"
      echo "  Worker    http://localhost:8787"
      echo ""
      exit 0 ;;
  esac
done

echo ""
head "Orquestra — Local Dev"
echo ""

# ── Prereq checks ─────────────────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  err "bun not found. Install: https://bun.sh"
  exit 1
fi
ok "bun $(bun --version)"

if ! command -v wrangler &>/dev/null; then
  err "wrangler not found. Install: bun add -g wrangler"
  exit 1
fi
ok "wrangler $(wrangler --version 2>/dev/null | head -1)"

# ── Install deps if node_modules missing ──────────────────────────────────────
if [[ ! -d "$ROOT/node_modules" ]]; then
  info "Installing dependencies..."
  bun install --cwd "$ROOT"
  ok "Dependencies installed"
fi

# ── DB operations ─────────────────────────────────────────────────────────────
if $DO_RESET; then
  echo ""
  info "Resetting local DB..."
  cd "$ROOT"
  wrangler d1 execute DB --local --command \
    "DROP TABLE IF EXISTS projects_fts; DROP TABLE IF EXISTS program_categories; DROP TABLE IF EXISTS ai_analyses; DROP TABLE IF EXISTS known_addresses; DROP TABLE IF EXISTS project_socials; DROP TABLE IF EXISTS api_keys; DROP TABLE IF EXISTS idl_versions; DROP TABLE IF EXISTS projects; DROP TABLE IF EXISTS users; DROP TABLE IF EXISTS d1_migrations;" \
    2>/dev/null && ok "DB reset" || err "DB reset failed (may not exist yet — continuing)"
fi

if $DO_MIGRATE; then
  echo ""
  info "Applying local DB migrations..."
  cd "$ROOT"
  wrangler d1 migrations apply DB --local
  ok "Migrations applied"
fi

if $DO_SEED; then
  echo ""
  info "Seeding dev data..."
  cd "$ROOT"
  if [[ -f "$ROOT/seed/dev.sql" ]]; then
    wrangler d1 execute DB --local --file "$ROOT/seed/dev.sql"
    ok "Dev seed applied"
  else
    err "No seed file at seed/dev.sql — skipping"
  fi
fi

# ── Write local env for frontend (points API calls to local worker) ───────────
ENV_LOCAL="$ROOT/packages/frontend/.env.local"
cat > "$ENV_LOCAL" << 'EOF'
VITE_API_URL=http://localhost:8787/api
VITE_WORKER_URL=http://localhost:8787
VITE_AUTH_URL=http://localhost:8787/auth
EOF
ok "Frontend env → localhost:8787"

cleanup() {
  echo ""
  info "Stopping..."
  kill $WORKER_PID $FRONTEND_PID 2>/dev/null
  rm -f "$ENV_LOCAL"
  exit 0
}

# ── Start services ────────────────────────────────────────────────────────────
echo ""
info "Starting services..."
echo ""
echo "  Worker   → http://localhost:8787"
echo "  Frontend → http://localhost:5173"
echo ""
info "Press Ctrl+C to stop all"
echo ""

cd "$ROOT"

# Start worker via wrangler directly (avoids bun script PATH issues)
wrangler dev --port 8787 &
WORKER_PID=$!

# Start frontend with local proxy config
cd "$ROOT/packages/frontend"
bunx vite --config vite.config.local.ts &
FRONTEND_PID=$!

trap cleanup INT TERM

wait
