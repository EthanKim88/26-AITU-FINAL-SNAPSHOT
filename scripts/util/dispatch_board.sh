#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
STATE_DIR="${DISPATCH_STATE_DIR:-$ROOT_DIR/.agents/state}"
BOARD_FILE="$STATE_DIR/dispatch-board.json"
LOCK_DIR="$STATE_DIR/.dispatch_board.lock"
LOCK_WAIT_TENTHS="${DISPATCH_LOCK_WAIT_TENTHS:-200}"

mkdir -p "$STATE_DIR"

usage() {
  cat >&2 <<'USAGE'
usage:
  dispatch_board.sh get
  dispatch_board.sh init
  dispatch_board.sh set-phase "<phase>"
  dispatch_board.sh sync-objective "<risk>"
  dispatch_board.sh assign "<worker>" "<role>" "<risk>" "<lane>" "<target>" "<goal>" "<why_now>" "<stop_if>" "<handoff_if>" "<evidence_needed>"
  dispatch_board.sh status "<worker>" "<status>" "<summary>"
  dispatch_board.sh clear-worker "<worker>"
  dispatch_board.sh reap-stale "<seconds>"
  dispatch_board.sh backlog "<lead>" "<reason>"
USAGE
  exit 1
}

now_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

acquire_lock() {
  waited=0
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    waited=$((waited + 1))
    if [ "$waited" -ge "$LOCK_WAIT_TENTHS" ]; then
      echo >&2 "dispatch_board lock timeout: $LOCK_DIR"
      exit 1
    fi
    sleep 0.1
  done
  trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM HUP
}

release_lock() {
  rm -rf "$LOCK_DIR"
  trap - EXIT INT TERM HUP
}

default_board() {
  cat <<'JSON'
{
  "objective": "",
  "phase": "opening",
  "updatedAt": "",
  "workers": {},
  "backlog": []
}
JSON
}

ensure_board() {
  if [ ! -f "$BOARD_FILE" ]; then
    default_board > "$BOARD_FILE"
  fi
}

cmd="${1:-}"

case "$cmd" in
  get)
    ensure_board
    cat "$BOARD_FILE"
    ;;
  init)
    acquire_lock
    python3 - "$BOARD_FILE" "$(now_utc)" <<'PY'
import json
import pathlib
import sys

board_file = pathlib.Path(sys.argv[1])
updated_at = sys.argv[2]
data = {
    "objective": "",
    "phase": "opening",
    "updatedAt": updated_at,
    "workers": {},
    "backlog": [],
}
tmp_file = board_file.with_name(board_file.name + ".tmp")
tmp_file.write_text(json.dumps(data, indent=2) + "\n")
tmp_file.replace(board_file)
print(json.dumps(data, ensure_ascii=True))
PY
    release_lock
    ;;
  set-phase)
    phase="${2:-}"
    [ -n "$phase" ] || usage
    ensure_board
    acquire_lock
    python3 - "$BOARD_FILE" "$phase" "$(now_utc)" <<'PY'
import json
import pathlib
import sys

board_file = pathlib.Path(sys.argv[1])
phase = sys.argv[2]
updated_at = sys.argv[3]
data = json.loads(board_file.read_text())
data["phase"] = phase
data["updatedAt"] = updated_at
tmp_file = board_file.with_name(board_file.name + ".tmp")
tmp_file.write_text(json.dumps(data, indent=2) + "\n")
tmp_file.replace(board_file)
print(json.dumps(data, ensure_ascii=True))
PY
    release_lock
    ;;
  sync-objective)
    risk="${2:-}"
    [ -n "$risk" ] || usage
    ensure_board
    acquire_lock
    python3 - "$BOARD_FILE" "$risk" "$(now_utc)" <<'PY'
import json
import pathlib
import sys

board_file = pathlib.Path(sys.argv[1])
risk = sys.argv[2]
updated_at = sys.argv[3]
data = json.loads(board_file.read_text())
previous = data.get("objective", "")
if previous != risk:
    data["workers"] = {}
    data["phase"] = "opening"
data["objective"] = risk
data["updatedAt"] = updated_at
tmp_file = board_file.with_name(board_file.name + ".tmp")
tmp_file.write_text(json.dumps(data, indent=2) + "\n")
tmp_file.replace(board_file)
print(json.dumps(data, ensure_ascii=True))
PY
    release_lock
    ;;
  assign)
    worker="${2:-}"
    role="${3:-}"
    risk="${4:-}"
    lane="${5:-}"
    target="${6:-}"
    goal="${7:-}"
    why_now="${8:-}"
    stop_if="${9:-}"
    handoff_if="${10:-}"
    evidence_needed="${11:-}"
    [ -n "$worker" ] && [ -n "$role" ] && [ -n "$risk" ] && [ -n "$lane" ] || usage
    ensure_board
    acquire_lock
    python3 - "$BOARD_FILE" "$worker" "$role" "$risk" "$lane" "$target" "$goal" "$why_now" "$stop_if" "$handoff_if" "$evidence_needed" "$(now_utc)" <<'PY'
import json
import pathlib
import sys

(
    board_path,
    worker,
    role,
    risk,
    lane,
    target,
    goal,
    why_now,
    stop_if,
    handoff_if,
    evidence_needed,
    updated_at,
) = sys.argv[1:]
board_file = pathlib.Path(board_path)
data = json.loads(board_file.read_text())
if not data.get("objective"):
    data["objective"] = risk
workers = data.setdefault("workers", {})
workers[worker] = {
    "role": role,
    "status": "assigned",
    "risk": risk,
    "lane": lane,
    "target": target,
    "goal": goal,
    "whyNow": why_now,
    "stopIf": stop_if,
    "handoffIf": handoff_if,
    "evidenceNeeded": evidence_needed,
    "summary": "",
    "updatedAt": updated_at,
}
data["updatedAt"] = updated_at
tmp_file = board_file.with_name(board_file.name + ".tmp")
tmp_file.write_text(json.dumps(data, indent=2) + "\n")
tmp_file.replace(board_file)
print(json.dumps(data, ensure_ascii=True))
PY
    release_lock
    ;;
  status)
    worker="${2:-}"
    status="${3:-}"
    summary="${4:-}"
    [ -n "$worker" ] && [ -n "$status" ] || usage
    ensure_board
    acquire_lock
    python3 - "$BOARD_FILE" "$worker" "$status" "$summary" "$(now_utc)" <<'PY'
import json
import pathlib
import sys

board_file = pathlib.Path(sys.argv[1])
worker = sys.argv[2]
status = sys.argv[3]
summary = sys.argv[4]
updated_at = sys.argv[5]
data = json.loads(board_file.read_text())
workers = data.setdefault("workers", {})
entry = workers.setdefault(worker, {})
entry["status"] = status
entry["summary"] = summary
entry["updatedAt"] = updated_at
data["updatedAt"] = updated_at
tmp_file = board_file.with_name(board_file.name + ".tmp")
tmp_file.write_text(json.dumps(data, indent=2) + "\n")
tmp_file.replace(board_file)
print(json.dumps(data, ensure_ascii=True))
PY
    release_lock
    ;;
  clear-worker)
    worker="${2:-}"
    [ -n "$worker" ] || usage
    ensure_board
    acquire_lock
    python3 - "$BOARD_FILE" "$worker" "$(now_utc)" <<'PY'
import json
import pathlib
import sys

board_file = pathlib.Path(sys.argv[1])
worker = sys.argv[2]
updated_at = sys.argv[3]
data = json.loads(board_file.read_text())
workers = data.setdefault("workers", {})
workers.pop(worker, None)
data["updatedAt"] = updated_at
tmp_file = board_file.with_name(board_file.name + ".tmp")
tmp_file.write_text(json.dumps(data, indent=2) + "\n")
tmp_file.replace(board_file)
print(json.dumps(data, ensure_ascii=True))
PY
    release_lock
    ;;
  reap-stale)
    max_age="${2:-}"
    [ -n "$max_age" ] || usage
    ensure_board
    acquire_lock
    python3 - "$BOARD_FILE" "$max_age" "$(now_utc)" <<'PY'
import datetime as dt
import json
import pathlib
import sys

board_file = pathlib.Path(sys.argv[1])
max_age = int(sys.argv[2])
updated_at = sys.argv[3]
data = json.loads(board_file.read_text())
workers = data.setdefault("workers", {})
now = dt.datetime.strptime(updated_at, "%Y-%m-%dT%H:%M:%SZ")
removed = []

for worker, entry in list(workers.items()):
    ts = entry.get("updatedAt", "")
    if not ts:
        removed.append(worker)
        workers.pop(worker, None)
        continue
    try:
        seen = dt.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        removed.append(worker)
        workers.pop(worker, None)
        continue
    age = (now - seen).total_seconds()
    if age > max_age:
        removed.append(worker)
        workers.pop(worker, None)

data["updatedAt"] = updated_at
tmp_file = board_file.with_name(board_file.name + ".tmp")
tmp_file.write_text(json.dumps(data, indent=2) + "\n")
tmp_file.replace(board_file)
print(json.dumps({"removedWorkers": removed, "board": data}, ensure_ascii=True))
PY
    release_lock
    ;;
  backlog)
    lead="${2:-}"
    reason="${3:-}"
    [ -n "$lead" ] && [ -n "$reason" ] || usage
    ensure_board
    acquire_lock
    python3 - "$BOARD_FILE" "$lead" "$reason" "$(now_utc)" <<'PY'
import json
import pathlib
import sys

board_file = pathlib.Path(sys.argv[1])
lead = sys.argv[2]
reason = sys.argv[3]
updated_at = sys.argv[4]
data = json.loads(board_file.read_text())
backlog = data.setdefault("backlog", [])
backlog.append({
    "lead": lead,
    "reason": reason,
    "addedAt": updated_at,
})
data["updatedAt"] = updated_at
tmp_file = board_file.with_name(board_file.name + ".tmp")
tmp_file.write_text(json.dumps(data, indent=2) + "\n")
tmp_file.replace(board_file)
print(json.dumps(data, ensure_ascii=True))
PY
    release_lock
    ;;
  *)
    usage
    ;;
esac
