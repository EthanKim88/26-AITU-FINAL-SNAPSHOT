#!/bin/bash
# msfrpcd daemon startup script
# Skip if already running, otherwise start in background

PORT="${MSFRPC_PORT:-55553}"
PASS="${MSFRPC_PASS:-changeme}"
MSF_DIR="$HOME/metasploit-framework"

if lsof -i :$PORT -sTCP:LISTEN &>/dev/null; then
    echo "[*] msfrpcd already running on port $PORT"
    exit 0
fi

echo "[*] Starting msfrpcd on port $PORT..."
eval "$(rbenv init - zsh 2>/dev/null || rbenv init - bash 2>/dev/null)"
cd "$MSF_DIR" && ./msfrpcd -P "$PASS" -S -a 127.0.0.1 -p $PORT -U msf &

echo "[*] Waiting for msfrpcd to start..."
for i in $(seq 1 30); do
    if lsof -i :$PORT -sTCP:LISTEN &>/dev/null; then
        echo "[+] msfrpcd ready on port $PORT"
        exit 0
    fi
    sleep 1
done

echo "[!] msfrpcd failed to start within 30 seconds"
exit 1
