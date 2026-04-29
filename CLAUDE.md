# CTF Agent Guide (Short)

This document defines the minimum operational rules for the AITU CTF Final.
The goal is to submit scorable reports quickly and accurately.

## Scoring Essentials
- This is **report-based scoring**, not traditional flag capture.
- Scoring paths: `Risk` reports + `Bug Bounty` reports.
- Risk score decreases by 15% each time the same item is accepted; floor is 40%.
- Bug Bounty: max 1,500 points per host.

Bug Bounty base scores:
- LPE 500, RCE 400, SQLi 300, SSTI 300, XXE 300, SSRF 200, Path Traversal/LFI 200, IDOR 100

## OODA (Loop)
1. Check current state and priority actions with `get_sitrep`
2. Select the highest-priority `pending` action
3. `claim_action`
4. Execute
5. `complete_action(done|failed, result)`
6. `heartbeat`

## Objective Lock
- If the user gives only generic continuation like `continue`, `keep going`, or `do the next thing`, use `/risk-autopilot` first.
- Maintain only one active objective at a time. State is tracked in `.agents/state/active_objective.json`.
- State changes are performed only via `scripts/util/objective_state.sh`:
  - `scripts/util/objective_state.sh get`
  - `scripts/util/objective_state.sh set "<risk>" "<lane>" "<reason>"`
  - `scripts/util/objective_state.sh lane "<lane>" "<reason>"`
  - `scripts/util/objective_state.sh backlog "<lead>" "<reason>"`
  - `scripts/util/objective_state.sh clear "<reason>"`
- Unrelated leads, hosts, or Bug Bounty items are sent to the backlog without breaking the current objective.
- Objective switch is allowed only when:
  - `completed`
  - `hard blocked`
  - `direct high-value jump`
  - `manual-only pause`
- Lane rotation is allowed but the objective must be maintained:
  - `web -> ad -> pivot -> scada -> report`
- While an active objective is alive, Bug Bounty is `same-chain only`.

## Session / Work Rules
- Start: `start_session` → `get_sitrep`
- Before working on a host: `claim_host` (if 409, move to another target)
- Checklist: maintain `enum -> exploit -> privesc` order
- Delegate long-running or interactive tasks via `request_task`

`request_task` recommended for:
- Full port scan (`nmap -p-`)
- Interactive PTY privilege escalation
- Tasks taking more than 10 minutes

## GPU Cracking (Hashcat)
- **hashcat/john cracking must always run on the GPU instance.**
- MCP/task label: `infra:hashcat-gpu:aws-apne2` (do not confuse with competition target host/credentials)
- IP: `<HASHCAT_IP>`
- SSH alias: `ssh aitufinal-hashcat-gpu`
- SSH direct: `ssh -i labs/infra/stacks/hashcat/hashcat-key.pem ubuntu@<HASHCAT_IP>`
- Upload hashes: `scp HASHES aitufinal-hashcat-gpu:~/crack/`
- Wordlist: `/opt/wordlists/rockyou.txt` (on the server)
- Working directory: `~/crack/`
- Instance type: `g4dn.xlarge` (NVIDIA T4)
- Do not register the `ubuntu`/pem SSH access to the hashcat server as an MCP credential. Only register actual competition accounts obtained from cracking via `add_credential` with `source=hashcat-gpu:<hash_source>`.
- Always clean up with `terraform destroy` after use (`labs/infra/stacks/hashcat/`)

## External Linux Callback Machine
- MCP/task label: `infra:callback-linux:public` (do not confuse with competition target host/credentials)
- IP: `<CALLBACK_IP>`
- SSH direct: `ssh root@<CALLBACK_IP>`
- Purpose: reverse shell callback, OOB verification, `nc`/`socat` listener, temporary HTTP payload hosting
- Since competition servers have external internet access, prefer this machine's public IP `<CALLBACK_IP>` over VPN local IP for simple callbacks.
- Use only this single machine as the operational callback host. Do not maintain a separate fallback callback host.
- Run listeners in `tmux`/`nohup` and clean up ports after use.
- Do not register this machine's `root` SSH access as an MCP credential.

## Terminal Safety Rules
- Forbidden: remote `vim/vi/nano`, `less/more/top/htop`, `sshuttle` foreground
- Alternatives: `cat`, `sed`, `tail -n`, `ssh -D 1080 -N -f`, `ligolo-ng`
- Delegate steps requiring interactive TTY via `request_task` instead of attaching directly

## Credential Rules
- Register new credentials immediately with `add_credential`
- Store plaintext and hashes separately
- Record hash/ticket materials with the appropriate `secretType` (`hash`/`ntlm`/`ticket`)
- Do not treat hash/ticket materials as authenticated until cracked
- `test_credential_access` records only **actually attempted host+protocol** combinations
- Spray only against targets with matching service/port

## Pivot / Tunneling Rules
- Priority: `ligolo-ng` > `chisel` > `ssh -D`
- Fix tunnel mode per segment (`segment -> mode`)
- Do not use duplicate routes on the same CIDR (e.g., ligolo route + socks simultaneously)
- In socks/chisel mode, use `proxychains4 -q` + TCP scan (`-sT`)

## Evidence / Data Recording
- Scan results: `import_scan_data`
- New/updated hosts: `add_host`, `update_host`
- Extracted files: `add_loot` (include source/port/type)
- Key attempts/results: `log_event`, `log_session_entry`
- Loot path convention: per-port `loots/<ip>/<port>/`, per-host `loots/<ip>/`

## Report Quality Rules
- Reproduction steps must be technically accurate and written step-by-step
- Risk reports must describe the full chain from start to finish
- PoC must include the exact payload/HTTP request
- Attached screenshots must be full-screen only (no cropping/editing)
- Long payloads/reverse shells/curl commands should be submitted as copy-pasteable text instead of images

## Prohibited Actions
- Modifying or deleting other users' or system files
- Deleting user accounts
- Attacking infrastructure services
- Attacking other teams or sharing information
- Attacking hosts outside the competition infrastructure scope
- DoS or aggressive/persistent scanning
- Using or creating accounts containing the `f13` string

## SCADA Notes
- Do not directly attack the SCADA web interface first.
- Obtain valid credentials/routes from within the infrastructure first.

## Network Scope
- DMZ: `10.10.13.0/27`
- DEV: `10.10.13.32/27`
- CORP: `10.10.13.64/27`
- Hackcity: `10.10.13.96/27`

## Quick Paths
- venv: `.venv/bin`
- recon: `scripts/recon/*`
- ad: `scripts/ad/*`
- scada: `scripts/scada/*`
- pivot: `scripts/pivot/*`
