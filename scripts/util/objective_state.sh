#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
STATE_DIR="${OBJECTIVE_STATE_DIR:-$ROOT_DIR/.agents/state}"
STATE_FILE="$STATE_DIR/active_objective.json"
LOCK_DIR="$STATE_DIR/.active_objective.lock"
LOCK_WAIT_TENTHS="${OBJECTIVE_LOCK_WAIT_TENTHS:-200}"

mkdir -p "$STATE_DIR"

usage() {
  cat >&2 <<'USAGE'
usage:
  objective_state.sh get
  objective_state.sh field <risk|lane|reason|updatedAt>
  objective_state.sh set "<risk>" "<lane>" "<reason>"
  objective_state.sh lane "<lane>" "<reason>"
  objective_state.sh backlog "<lead>" "<reason>"
  objective_state.sh clear [reason]
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
      echo >&2 "objective_state lock timeout: $LOCK_DIR"
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

read_state() {
  if [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE"
  else
    printf '{}\n'
  fi
}

cmd="${1:-}"

case "$cmd" in
  get)
    read_state
    ;;
  field)
    key="${2:-}"
    [ -n "$key" ] || usage
    python3 - "$STATE_FILE" "$key" <<'PY'
import json
import pathlib
import sys

state_file = pathlib.Path(sys.argv[1])
key = sys.argv[2]
data = {}
if state_file.exists():
    try:
        data = json.loads(state_file.read_text())
    except Exception:
        data = {}
value = data.get(key, "")
if isinstance(value, (dict, list)):
    print(json.dumps(value, ensure_ascii=True))
else:
    print(value)
PY
    ;;
  set)
    risk="${2:-}"
    lane="${3:-}"
    reason="${4:-}"
    [ -n "$risk" ] && [ -n "$lane" ] && [ -n "$reason" ] || usage
    acquire_lock
    python3 - "$STATE_FILE" "$risk" "$lane" "$reason" "$(now_utc)" <<'PY'
import json
import pathlib
import sys

state_file = pathlib.Path(sys.argv[1])
risk = sys.argv[2]
lane = sys.argv[3]
reason = sys.argv[4]
updated_at = sys.argv[5]

data = {}
if state_file.exists():
    try:
        data = json.loads(state_file.read_text())
    except Exception:
        data = {}
backlog = data.get("backlog", [])
payload = {
    "risk": risk,
    "lane": lane,
    "reason": reason,
    "updatedAt": updated_at,
    "backlog": backlog,
}
tmp_file = state_file.with_name(state_file.name + ".tmp")
tmp_file.write_text(json.dumps(payload, indent=2) + "\n")
tmp_file.replace(state_file)
print(json.dumps(payload, ensure_ascii=True))
PY
    release_lock
    ;;
  lane)
    lane="${2:-}"
    reason="${3:-}"
    [ -n "$lane" ] && [ -n "$reason" ] || usage
    acquire_lock
    python3 - "$STATE_FILE" "$lane" "$reason" "$(now_utc)" <<'PY'
import json
import pathlib
import sys

state_file = pathlib.Path(sys.argv[1])
lane = sys.argv[2]
reason = sys.argv[3]
updated_at = sys.argv[4]

data = {}
if state_file.exists():
    try:
        data = json.loads(state_file.read_text())
    except Exception:
        data = {}
if not data.get("risk"):
    print("{}")
    sys.exit(0)
data["lane"] = lane
data["reason"] = reason
data["updatedAt"] = updated_at
data.setdefault("backlog", [])
tmp_file = state_file.with_name(state_file.name + ".tmp")
tmp_file.write_text(json.dumps(data, indent=2) + "\n")
tmp_file.replace(state_file)
print(json.dumps(data, ensure_ascii=True))
PY
    release_lock
    ;;
  backlog)
    lead="${2:-}"
    reason="${3:-}"
    [ -n "$lead" ] && [ -n "$reason" ] || usage
    acquire_lock
    python3 - "$STATE_FILE" "$lead" "$reason" "$(now_utc)" <<'PY'
import json
import pathlib
import sys

state_file = pathlib.Path(sys.argv[1])
lead = sys.argv[2]
reason = sys.argv[3]
updated_at = sys.argv[4]

data = {}
if state_file.exists():
    try:
        data = json.loads(state_file.read_text())
    except Exception:
        data = {}
backlog = data.setdefault("backlog", [])
backlog.append({
    "lead": lead,
    "reason": reason,
    "addedAt": updated_at,
})
data.setdefault("risk", "")
data.setdefault("lane", "")
data.setdefault("reason", "")
data["updatedAt"] = updated_at
tmp_file = state_file.with_name(state_file.name + ".tmp")
tmp_file.write_text(json.dumps(data, indent=2) + "\n")
tmp_file.replace(state_file)
print(json.dumps(data, ensure_ascii=True))
PY
    release_lock
    ;;
  clear)
    acquire_lock
    if [ -f "$STATE_FILE" ]; then
      rm -f "$STATE_FILE"
    fi
    reason="${2:-}"
    if [ -n "$reason" ]; then
      printf '{"cleared":true,"reason":"%s"}\n' "$reason"
    else
      printf '{"cleared":true}\n'
    fi
    release_lock
    ;;
  *)
    usage
    ;;
esac
