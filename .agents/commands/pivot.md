---
description: Pivot/Tunneling skill execution wrapper. Establishes tunnels + scans internal segments + reflects to MCP hosts.
---

# /pivot

`/pivot <pivot_ip>`

Behavior:
1. Loads `.claude/skills/pivot/SKILL.md`.
2. Parses arguments using `argument-hint` rules.
3. Auto-detects/attempts `target_cidr`, `username`, `password` based on the pivot IP.
4. Establishes tunnel (ligolo/ssh/chisel) -> scans internal network -> reflects via `import_scan_data` and `add_host`/`update_host`.
5. Applies mixed tunnel policy: fixed `mode` per segment, enforces `proxychains4 -q` for `socks/chisel` segments, records `segment=<cidr>;mode=<mode>` in MCP notes.
6. ligolo `session/start` is automatically performed via `./scripts/pivot/ligolo-tunnel.sh start <pivot_ip> ...`.
