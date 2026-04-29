#!/bin/bash
# reset.sh — Reset the platform to a clean initial state.
# Deletes all competition data (DBs, loots, agent state, caches).
#
# Usage:
#   ./scripts/reset.sh          # Interactive confirmation
#   ./scripts/reset.sh --force  # Skip confirmation

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ "${1:-}" != "--force" ]; then
  echo -e "${YELLOW}This will delete ALL competition data:${NC}"
  echo "  - SQLite databases (web-app/prisma/*.db)"
  echo "  - Loots directory (loots/)"
  echo "  - Agent state files (.agents/state/*.json)"
  echo "  - Python caches (__pycache__/, *.pyc)"
  echo "  - .DS_Store files"
  echo ""
  read -p "Continue? [y/N] " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Aborted."
    exit 0
  fi
fi

echo -e "${YELLOW}[1/5] Removing databases...${NC}"
rm -f "$ROOT/web-app/prisma/ctf-ops.db" \
      "$ROOT/web-app/prisma/dev.db"
echo -e "  ${GREEN}Done${NC}"

echo -e "${YELLOW}[2/5] Removing loots...${NC}"
if [ -d "$ROOT/loots" ]; then
  rm -rf "$ROOT/loots"
  mkdir -p "$ROOT/loots"
  echo "# Extracted artifacts are stored here (organized by host/port)" > "$ROOT/loots/.gitkeep"
fi
echo -e "  ${GREEN}Done${NC}"

echo -e "${YELLOW}[3/5] Resetting agent state...${NC}"
echo '{}' > "$ROOT/.agents/state/active_objective.json"
echo '{}' > "$ROOT/.agents/state/dispatch-board.json"
echo -e "  ${GREEN}Done${NC}"

echo -e "${YELLOW}[4/5] Cleaning caches...${NC}"
find "$ROOT" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$ROOT" -type f -name "*.pyc" -delete 2>/dev/null || true
find "$ROOT" -type f -name ".DS_Store" -delete 2>/dev/null || true
echo -e "  ${GREEN}Done${NC}"

echo -e "${YELLOW}[5/5] Reinitializing database...${NC}"
cd "$ROOT/web-app"
if command -v pnpm &>/dev/null; then
  pnpm db:generate 2>/dev/null || true
  pnpm db:migrate 2>/dev/null || echo -e "  ${YELLOW}Run 'cd web-app && pnpm db:migrate' to apply migrations${NC}"
else
  echo -e "  ${YELLOW}pnpm not found. Run manually: cd web-app && pnpm db:migrate${NC}"
fi
echo -e "  ${GREEN}Done${NC}"

echo ""
echo -e "${GREEN}Reset complete. Platform is ready for a fresh session.${NC}"
