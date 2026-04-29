#!/bin/bash
# CTF Ops - DB Reset
# Deletes the SQLite database (+ WAL/SHM) and recreates the schema
# NOTE: Restart the Next.js dev server after running this script

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="$PROJECT_DIR/prisma/ctf-ops.db"

echo "Resetting CTF Ops database..."

# Delete DB + WAL/SHM files (SQLite journal files)
for f in "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm" "$DB_PATH-journal"; do
  if [ -f "$f" ]; then
    rm -f "$f"
    echo "Deleted: $f"
  fi
done

cd "$PROJECT_DIR"
npx prisma db push

echo ""
echo "Database reset complete."
echo "⚠ Restart the Next.js dev server (pnpm dev) for changes to take effect."
