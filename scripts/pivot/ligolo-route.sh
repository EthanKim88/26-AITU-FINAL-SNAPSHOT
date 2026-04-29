#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-up}"
shift || true

if [[ $# -gt 0 ]]; then
  CIDRS=("$@")
else
  echo "ERROR: CIDR argument(s) required."
  echo "Usage: $0 up|down|status <cidr> [cidr...]"
  echo "Example: $0 up 172.16.0.0/24"
  exit 1
fi

usage() {
  cat <<'EOF'
Usage:
  ./scripts/pivot/ligolo-route.sh up [cidr...]
  ./scripts/pivot/ligolo-route.sh down [cidr...]
  ./scripts/pivot/ligolo-route.sh status

Default CIDRs (when omitted):
  10.1.3.0/24 10.1.4.0/24
EOF
}

is_macos() {
  [[ "$(uname -s)" == "Darwin" ]]
}

iface_ipv4() {
  local iface="$1"
  ifconfig "$iface" 2>/dev/null | awk '/inet /{print $2; exit}'
}

pick_alias_ip() {
  local candidate
  for n in $(seq 2 254); do
    candidate="198.18.0.${n}"
    if ! ifconfig | grep -q "inet ${candidate} "; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

ensure_macos_utun_alias() {
  local iface="$1"
  is_macos || return 0

  local existing
  existing="$(iface_ipv4 "$iface" || true)"
  if [[ -n "$existing" ]]; then
    return 0
  fi

  local alias_ip
  alias_ip="$(pick_alias_ip)" || {
    echo "ERROR: failed to find free IPv4 alias for $iface"
    return 1
  }

  sudo ifconfig "$iface" alias "$alias_ip" 255.255.255.0
  echo "Assigned macOS utun alias: $iface -> $alias_ip/24"
}

add_route_checked() {
  local cidr="$1"
  local iface="$2"
  local out rc

  out="$(sudo route -n add -net "$cidr" -interface "$iface" 2>&1)" || rc=$?
  rc="${rc:-0}"

  if [[ $rc -ne 0 ]] || echo "$out" | grep -Eiq 'Network is unreachable|not in table|bad value'; then
    echo "$out"
    return 1
  fi

  # route(8) on macOS can still print warnings while returning 0; keep output visible.
  [[ -n "$out" ]] && echo "$out"
  return 0
}

delete_route_if_exists() {
  local cidr="$1"
  sudo route -n delete -net "$cidr" >/dev/null 2>&1 || true
}

show_status() {
  echo "Current ligolo routing entries:"
  local iface
  iface="$("$SCRIPT_DIR/ligolo-iface.sh" --ligolo 2>/dev/null || true)"
  if [[ -n "$iface" ]]; then
    netstat -rn -f inet | awk -v i="$iface" 'NR<=2 || $NF==i'
  else
    netstat -rn -f inet | awk 'NR<=2 || /utun/'
  fi
}

case "$MODE" in
  up)
    iface="$("$SCRIPT_DIR/ligolo-iface.sh" --ligolo)"
    if [[ -z "${iface:-}" ]]; then
      echo "ERROR: no utun interface found."
      exit 1
    fi
    echo "Using interface: $iface"
    ensure_macos_utun_alias "$iface"
    for cidr in "${CIDRS[@]}"; do
      delete_route_if_exists "$cidr"
      add_route_checked "$cidr" "$iface"
      echo "Route set: $cidr -> $iface"
    done
    show_status
    ;;
  down)
    for cidr in "${CIDRS[@]}"; do
      delete_route_if_exists "$cidr"
      echo "Route removed (if existed): $cidr"
    done
    show_status
    ;;
  status)
    show_status
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "ERROR: unknown mode '$MODE'"
    usage
    exit 1
    ;;
esac
