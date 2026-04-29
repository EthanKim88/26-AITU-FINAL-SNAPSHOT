#!/usr/bin/env bash
set -euo pipefail

list_utun() {
  ifconfig -l | tr ' ' '\n' | grep '^utun' | sort -t'n' -k2,2n
}

iface_ip() {
  ifconfig "$1" 2>/dev/null | awk '/inet /{print $2; exit}'
}

iface_mtu() {
  ifconfig "$1" 2>/dev/null | awk '/mtu/{print $NF; exit}'
}

pick_latest_utun() {
  list_utun | tail -1
}

pick_ligolo_utun() {
  local candidate=""
  while read -r iface; do
    [[ -z "$iface" ]] && continue
    local ip mtu
    ip="$(iface_ip "$iface" || true)"
    mtu="$(iface_mtu "$iface" || true)"
    if [[ -z "$ip" && "$mtu" == "1500" ]]; then
      candidate="$iface"
    fi
  done < <(list_utun)

  if [[ -n "$candidate" ]]; then
    echo "$candidate"
  else
    pick_latest_utun
  fi
}

case "${1:-}" in
  --latest)
    pick_latest_utun
    exit 0
    ;;
  --ligolo)
    pick_ligolo_utun
    exit 0
    ;;
  -h|--help)
    cat <<'EOF'
Usage:
  ligolo-iface.sh           # show utun list and suggestions
  ligolo-iface.sh --latest  # print highest-numbered utun
  ligolo-iface.sh --ligolo  # print likely ligolo utun (fallback: latest)
EOF
    exit 0
    ;;
esac

echo "All utun interfaces:"
echo ""
while read -r iface; do
  [[ -z "$iface" ]] && continue
  ip="$(iface_ip "$iface" || true)"
  mtu="$(iface_mtu "$iface" || true)"
  printf "  %-8s  ip=%-20s  mtu=%s\n" "$iface" "${ip:-none}" "$mtu"
done < <(list_utun)

echo ""
echo "Tip: ligolo usually uses a high-numbered utun with no IP and mtu=1500."
echo ""

newest="$(pick_latest_utun)"
ligolo_iface="$(pick_ligolo_utun)"

# Detect newly created interface since proxy started
new_iface=""
if [[ -f /tmp/.ligolo-utun-before ]]; then
  before_list="$(sort /tmp/.ligolo-utun-before)"
  after_list="$(list_utun)"
  new_iface="$(comm -13 <(echo "$before_list") <(echo "$after_list") | head -1)"
fi

echo "Newest utun        : $newest"
echo "Likely ligolo utun : $ligolo_iface"
if [[ -n "$new_iface" ]]; then
  echo "New since proxy    : $new_iface  <-- use this"
fi
echo ""
echo "Suggested route command:"
echo "  ./scripts/pivot/ligolo-route.sh up <cidr>"
