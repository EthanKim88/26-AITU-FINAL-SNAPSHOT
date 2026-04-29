#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROXY="$ROOT_DIR/tools/bins/darwin-arm64/ligolo-proxy"
CONFIG_FILE="$ROOT_DIR/ligolo-ng.yaml"
PORT="${1:-11601}"

if [[ ! -x "$PROXY" ]]; then
  echo "ERROR: ligolo-proxy not found at $PROXY"
  exit 1
fi

sanitize_config() {
  [[ -f "$CONFIG_FILE" ]] || return 0

  local tmp changed
  tmp="$(mktemp)"
  awk '
    /^interface:[[:space:]]*$/ { skip=1; next }
    skip && /^[^[:space:]]/ { skip=0 }
    !skip { print }
  ' "$CONFIG_FILE" >"$tmp"

  if ! cmp -s "$CONFIG_FILE" "$tmp"; then
    mv "$tmp" "$CONFIG_FILE"
    changed=1
  else
    rm -f "$tmp"
    changed=0
  fi

  if [[ "$changed" -eq 1 ]]; then
    echo "NOTE: removed stale 'interface' state from $(basename "$CONFIG_FILE") for clean startup."
    echo ""
  fi
}

# Detect VPN interface (WireGuard typically uses utun with 10.x.x.x IP)
detect_vpn() {
  local iface ip
  for iface in $(ifconfig -l | tr ' ' '\n' | grep utun | sort); do
    ip="$(ifconfig "$iface" 2>/dev/null | awk '/inet /{print $2; exit}')"
    if [[ -n "$ip" && "$ip" =~ ^10\. ]]; then
      echo "$iface $ip"
      return 0
    fi
  done
  echo "- N/A"
}

sanitize_config

# Snapshot current utun list (before proxy creates its own)
before=$(ifconfig -l | tr ' ' '\n' | grep utun | sort)
echo "$before" > /tmp/.ligolo-utun-before

vpn_info="$(detect_vpn)"
vpn_iface="${vpn_info%% *}"
vpn_ip="${vpn_info##* }"

echo "============================================"
echo "  ligolo-proxy launcher"
echo "============================================"
echo ""
echo "  Listen port : 0.0.0.0:$PORT"
echo "  VPN iface   : $vpn_iface ($vpn_ip)"
echo ""
echo "--------------------------------------------"
echo "  1) Agent connects → ligolo console:"
echo "       session → ifconfig → start"
echo ""
echo "  2) After 'start', new utun appears here."
echo "     Then in another terminal:"
echo "       $SCRIPT_DIR/ligolo-iface.sh"
echo "       $SCRIPT_DIR/ligolo-route.sh up <cidr>"
echo "--------------------------------------------"
echo ""

# Background watcher: detects new utun after 'start' and prints it
(
  for _ in $(seq 1 90); do
    sleep 2
    after=$(ifconfig -l | tr ' ' '\n' | grep utun | sort)
    new_iface=$(comm -13 <(echo "$before") <(echo "$after") | head -1)
    if [[ -n "$new_iface" ]]; then
      echo ""
      echo ">>> New ligolo interface: $new_iface <<<"
      echo ">>> Route cmd: $SCRIPT_DIR/ligolo-route.sh up <cidr>"
      echo ""
      break
    fi
  done
) &

exec "$PROXY" -selfcert -laddr "0.0.0.0:$PORT"
