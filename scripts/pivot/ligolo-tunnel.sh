#!/usr/bin/env bash
set -euo pipefail

API_URL="${LIGOLO_API_URL:-http://127.0.0.1:8080}"
LIGOLO_USER="${LIGOLO_USER:-ligolo}"
LIGOLO_PASS="${LIGOLO_PASS:-password}"
WAIT_SECONDS="${LIGOLO_WAIT_SECONDS:-30}"
# Keep disabled by default: pushing routes via API can persist stale state in ligolo-ng.yaml.
API_ROUTE_PUSH="${LIGOLO_API_ROUTE_PUSH:-0}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/pivot/ligolo-tunnel.sh status
  ./scripts/pivot/ligolo-tunnel.sh start <pivot_ip> [interface] [cidr...]
  ./scripts/pivot/ligolo-tunnel.sh stop <pivot_ip>

Examples:
  ./scripts/pivot/ligolo-tunnel.sh status
  ./scripts/pivot/ligolo-tunnel.sh start 10.1.2.10 utun10 10.1.3.0/24
  ./scripts/pivot/ligolo-tunnel.sh stop 10.1.2.10
EOF
}

require_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: '$1' is required."
    exit 1
  }
}

require_bin curl
require_bin jq

auth_token() {
  curl -fsS -X POST "$API_URL/api/auth" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$LIGOLO_USER\",\"password\":\"$LIGOLO_PASS\"}" \
    | jq -r '.token // empty'
}

TOKEN="$(auth_token)"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: failed to get ligolo token from $API_URL/api/auth"
  exit 1
fi

api_get() {
  local path="$1"
  curl -fsS -H "Authorization: $TOKEN" "$API_URL/$path"
}

api_post() {
  local path="$1"
  local body="$2"
  curl -fsS -X POST -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
    -d "$body" "$API_URL/$path"
}

api_delete() {
  local path="$1"
  local body="${2:-}"
  if [[ -n "$body" ]]; then
    curl -fsS -X DELETE -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
      -d "$body" "$API_URL/$path"
  else
    curl -fsS -X DELETE -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
      "$API_URL/$path"
  fi
}

find_agent_id() {
  local pivot_ip="$1"
  api_get "api/v1/agents" | jq -r --arg ip "$pivot_ip" '
    to_entries[]
    | select(
        ((.value.RemoteAddr // "") | startswith($ip + ":"))
        or any((.value.Network // [])[]?.Addresses[]?; startswith($ip + "/"))
      )
    | .key
  ' | tail -n1
}

wait_agent_id() {
  local pivot_ip="$1"
  local i
  for i in $(seq 1 "$WAIT_SECONDS"); do
    local id
    id="$(find_agent_id "$pivot_ip" || true)"
    if [[ -n "$id" ]]; then
      echo "$id"
      return 0
    fi
    sleep 1
  done
  return 1
}

ensure_interface() {
  local iface="$1"
  local exists
  exists="$(api_get "api/v1/interfaces" | jq -r --arg i "$iface" 'has($i)')"
  if [[ "$exists" != "true" ]]; then
    api_post "api/v1/interfaces" "$(jq -cn --arg iface "$iface" '{interface:$iface}')" >/dev/null
  fi
}

add_routes() {
  local iface="$1"
  shift || true
  [[ $# -eq 0 ]] && return 0

  local existing to_add routes_json payload route post_out
  # Make start idempotent: skip routes already present on this interface.
  existing="$(api_get "api/v1/interfaces" | jq -r --arg i "$iface" '.[$i].Routes[]?.Destination // empty' || true)"
  to_add=()
  for route in "$@"; do
    if printf '%s\n' "$existing" | grep -Fxq -- "$route"; then
      continue
    fi
    to_add+=("$route")
  done

  [[ ${#to_add[@]} -eq 0 ]] && return 0

  routes_json="$(printf '%s\n' "${to_add[@]}" | jq -R . | jq -s .)"
  payload="$(jq -cn --arg iface "$iface" --argjson routes "$routes_json" '{interface:$iface,route:$routes}')"
  post_out="$(api_post "api/v1/routes" "$payload" 2>&1)" || {
    # Handle race where another process added the same route between read and write.
    if printf '%s' "$post_out" | grep -qi "already exists"; then
      return 0
    fi
    echo "$post_out" >&2
    return 1
  }
}

start_tunnel() {
  local agent_id="$1"
  local iface="$2"
  api_post "api/v1/tunnel/$agent_id" "$(jq -cn --arg iface "$iface" '{interface:$iface}')"
}

stop_tunnel() {
  local agent_id="$1"
  api_delete "api/v1/tunnel/$agent_id"
}

delete_interface() {
  local iface="$1"
  api_delete "api/v1/interfaces" "$(jq -cn --arg iface "$iface" '{interface:$iface}')"
}

cleanup_stale_interfaces() {
  local stale
  stale="$(api_get "api/v1/interfaces" | jq -r '
    to_entries[]
    | select(
        (.key | test("^(utun[0-9]+|ligolo)$"))
        and ((.value.Active // false) == false)
      )
    | .key
  ')"

  [[ -z "$stale" ]] && return 0

  while read -r iface; do
    [[ -z "$iface" ]] && continue
    delete_interface "$iface" >/dev/null || true
    echo "INFO: removed stale ligolo interface '$iface'" >&2
  done <<< "$stale"
}

wait_tunnel_running() {
  local agent_id="$1"
  local i running
  for i in $(seq 1 "$WAIT_SECONDS"); do
    running="$(api_get "api/v1/agents" | jq -r --arg id "$agent_id" '.[$id].Running // false')"
    if [[ "$running" == "true" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

cmd="${1:-}"
case "$cmd" in
  status)
    echo "API: $API_URL"
    echo ""
    echo "[agents]"
    api_get "api/v1/agents" | jq .
    echo ""
    echo "[interfaces]"
    api_get "api/v1/interfaces" | jq .
    ;;
  start)
    pivot_ip="${2:-}"
    # macOS ligolo API expects utun* style interface names.
    iface="${3:-utun10}"
    if [[ $# -ge 3 ]]; then
      shift 3
    else
      shift "$#"
    fi
    routes=("$@")

    if [[ -z "$pivot_ip" ]]; then
      echo "ERROR: missing pivot_ip"
      usage
      exit 1
    fi

    agent_id="$(wait_agent_id "$pivot_ip" || true)"
    if [[ -z "$agent_id" ]]; then
      echo "ERROR: no ligolo agent matched pivot IP '$pivot_ip' within ${WAIT_SECONDS}s"
      exit 1
    fi

    cleanup_stale_interfaces
    ensure_interface "$iface"
    resp="$(start_tunnel "$agent_id" "$iface")"

    if ! wait_tunnel_running "$agent_id"; then
      echo "ERROR: tunnel did not reach Running=true within ${WAIT_SECONDS}s"
      echo "Agent status:"
      api_get "api/v1/agents" | jq --arg id "$agent_id" '.[$id]'
      exit 1
    fi

    if [[ ${#routes[@]} -gt 0 && "$API_ROUTE_PUSH" == "1" ]]; then
      add_routes "$iface" "${routes[@]}"
    fi

    echo "Started tunnel:"
    echo "  pivot_ip : $pivot_ip"
    echo "  agent_id : $agent_id"
    echo "  iface    : $iface"
    if [[ ${#routes[@]} -gt 0 ]]; then
      if [[ "$API_ROUTE_PUSH" == "1" ]]; then
        echo "  routes   : ${routes[*]} (pushed via API)"
      else
        echo "  routes   : ${routes[*]} (not pushed via API)"
        echo "  next     : ./scripts/pivot/ligolo-route.sh up ${routes[*]}"
      fi
    fi
    echo "  response : $resp"
    ;;
  stop)
    pivot_ip="${2:-}"
    if [[ -z "$pivot_ip" ]]; then
      echo "ERROR: missing pivot_ip"
      usage
      exit 1
    fi

    agent_id="$(find_agent_id "$pivot_ip" || true)"
    if [[ -z "$agent_id" ]]; then
      echo "ERROR: no ligolo agent matched pivot IP '$pivot_ip'"
      exit 1
    fi

    resp="$(stop_tunnel "$agent_id")"
    echo "Stopped tunnel: pivot_ip=$pivot_ip agent_id=$agent_id response=$resp"
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "ERROR: unknown command '$cmd'"
    usage
    exit 1
    ;;
esac
