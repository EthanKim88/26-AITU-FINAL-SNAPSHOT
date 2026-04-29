---
name: solve-web
description: "Web/DMZ attack (token-optimized): source collection -> code analysis -> vulnerability verification -> evidence/report. Even without a target, automatically selects a reachable web target from MCP and continues."
argument-hint: "[target_ip] [port=80]"
---

# solve-web (Token-Optimized)

Target: `$ARGUMENTS` or the web target auto-selected from MCP

Arguments:
- `arg1` = `target_ip` (optional)
- `arg2` = `port` (optional, default `80`)

## Reference
- `/.idea/tool-list.md`
- `/docs/aitu-final.md`
- `/.claude/skills/risk-autopilot/references/objective-lock.md`
- `/.claude/skills/risk-autopilot/references/risk-priority.md`
- `/.claude/skills/solve-ad/SKILL.md` (pivot/credential linkage)
- `/.claude/skills/report-bug/SKILL.md` (web report synchronization)

## Tool Path Index

```bash
ROOT="."  # repository root
VENV="$ROOT/.venv/bin"
LOOT_BASE="$ROOT/loots"
STATE="$ROOT/scripts/util/objective_state.sh"

# Web
curl
wget
rg
ffuf

# Reuse
$VENV/NetExec
$VENV/mssqlclient.py
$VENV/secretsdump.py
```

## Tool Contract (MUST)
- Context/priority: MCP `start_session`, `get_sitrep`, `claim_host`, `update_checklist`, `heartbeat`
- Web evidence collection: `curl/wget` + `add_loot`
- Code analysis: search for sinks/routes with `rg`
- Credential discovery: `add_credential` + `add_loot`
- Network/host changes: `add_host`, `update_host`
- Result events: `log_event`, `log_session_entry`
- First restore the active objective with `scripts/util/objective_state.sh get`. If the current host does not directly advance that objective, do not dig into it immediately; record it only as backlog.
- If the user does not specify a host, autonomously pick a reachable web target from MCP. Do not ask the user "Which host should we look at?"
- **Score-first rule**: Bug Bounty has a host cap (1500) and submission timing matters, so claim immediately after verification
- **Bug Bounty same-chain rule**: Call `/report-bug <ip>:<port> <BugType>` only when it is a byproduct of the same host/same exploit chain as the current objective
- Detail refinement is handled via subsequent PATCH; do not delay the initial claim
- 10+ minute tasks / interactive tasks: `request_task`

## External Callback Infra
- For simple reverse shell, SSRF/OOB verification, webhook/callback validation, and temporary payload hosting, prefer the external Linux machine `infra:callback-linux:public`.
- Access: `ssh root@<CALLBACK_IP>`
- callback IP/LHOST: `<CALLBACK_IP>`
- The operational standard is to use only `<CALLBACK_IP>` as the callback host. Do not maintain a separate fallback callback host.
- The current callback baseline services are `8443/tcp` reverse `chisel` server and `8000/tcp` payload HTTP server.
- Quick check before use: `ssh root@<CALLBACK_IP> 'ss -lntp | egrep \":8443|:8000\"'`
- The callback host working root is fixed at `/var/lib/pixel`. Collect binaries, payloads, logs, and temporary artifacts under its subdirectories (`bin`, `payloads`, `logs`, `tmp`).
- Available tools: `nc`, `socat`, `python3`, `curl`, `wget`, `tmux`
- When a reverse shell listener is needed, prefer launching `nc 4444` foreground on demand rather than long-running `nohup` resident mode.
- This external machine and its SSH access are not registered as MCP host/credential. If evidence/logs are needed, record only with `add_note` or `log_session_entry`.

## Autonomous Target Selection (Default)

If `arg1` is empty, automatically determine using the following order.

1. `scripts/util/objective_state.sh get`
2. If the active objective is empty, do not pick an arbitrary web host; return to `risk-autopilot`.
3. `get_sitrep`
4. First build a candidate pool matching the active objective's web targets.
   - `Railway Ticket` -> `ticket`, `booking`, `rail`, `gateway`, `checkout`, `payment`
   - `Source code leakage` -> `repo`, `git`, `dev`, `scm`, `artifact`
   - `Secret contracts` -> `delivery`, `shipping`, `partner`, `contract`
   - `Prediction market report` -> `market`, `report`, `trade`, `prediction`
   - `Healthcare dump` -> `health`, `medical`, `portal`, `patient`
   - `CORP/DEV/HACKCITY/SCADA chain` -> `web foothold`, `secret`, `internal URL`, `deploy key`, `operator portal`
5. From reachable segments, select only hosts with open web ports (`80`, `443`, `3000`, `5000`, `8000`, `8080`, `8443`) that match the above candidate pool.
6. If there are multiple candidates for the same objective, prioritize:
   - Hosts not yet `claim_host`ed
   - Hosts that already have loot/notes related to the active objective
   - Hosts with little loot/notes where new evidence can be generated quickly
7. If there are no objective candidates, do not ask the user; record `scripts/util/objective_state.sh backlog "<segment-or-host>" "web candidate exists but not same-chain"` and hand off to `solve-ad`, `pivot`, `uv run scripts/recon/scan_and_import.py -t <cidr> [--deep]`, or `risk-autopilot` within the same objective.

## Risk Bias (AITU Final)
- Target quick web/data Risks first:
  1. `Railway Ticket`
  2. `Source code leakage`
  3. `Secret contracts`
  4. `Prediction market report`
  5. `Healthcare dump`
- Prepare to immediately connect domain accounts/internal IPs/OT clues found on web to `solve-ad` or `solve-scada`.

## Objective Gate
- If the active objective is a web/data Risk, only look at hosts directly tied to that Risk.
- If the active objective is an AD/SCADA chain, only look at hosts that `advance that chain` such as web foothold, credential harvest, internal URL, repo secret.
- For web hosts unrelated to the current objective, only record in `scripts/util/objective_state.sh backlog "<host>" "not same-chain"` and do not switch.

## Minimal Checklist (content + tools)

- [01 Preflight] Tool: MCP
1. `start_session(title="Web: <ip>:<port>")` (if none exists)
2. `get_sitrep`
3. `claim_host`
4. `update_checklist(enumStatus="in-progress")`

- [02 Tech Fingerprint] Tool: `curl`
```bash
curl -sI http://<ip>:<port>/
curl -s http://<ip>:<port>/ > /tmp/index_<ip>.html
```
MCP: `add_note`, `log_event(scan)`

- [03 Source Collection] Tool: `wget/curl`
```bash
mkdir -p $LOOT_BASE/<ip>/<port>/src
wget -r -l 5 -np -nH --cut-dirs=0 -P $LOOT_BASE/<ip>/<port>/src -e robots=off http://<ip>:<port>/
```
MCP: `add_loot(lootType=source-code)`

- [04 Route/API Map] Tool: `rg`, `curl`
```bash
rg -n "(route|router|app\.|fetch\(|axios|/api/)" $LOOT_BASE/<ip>/<port>/src -S
```
MCP: `add_loot(filename=api.md)`

- [05 Code-first Vulnerability Hunt] Tool: `rg`
Priority (by score): `LPE(500) > RCE(400) > SQLi/SSTI/XXE(300) > SSRF/LFI(200) > IDOR(100)`
```bash
rg -n "(system\(|exec\(|shell_exec\(|os\.system\(|subprocess\.|eval\(|mysqli_query\(|SELECT .*\$|render_template_string|xml|file_get_contents\(|include\(|readFile\()" $LOOT_BASE/<ip>/<port>/src -S
```
MCP: `log_session_entry(analysis)`

- [06 PoC Validation] Tool: `curl` (+ `ffuf` if needed)
- First secure the minimum claimable evidence (1 reproduction command + 1 response + 1 line of impact)
- Save payload/HTTP request as text
MCP: `add_loot(poc.txt|http.txt)`, `log_event(exploit)`

- [07 Immediate Report Sync] Tool: `/report-bug` skill
- When a Bug Bounty is verified as `same-chain`, preemptively claim with Host+Type without delay:
```text
/report-bug <ip>:<port> <BugType>
```
- Even if additional vulnerabilities are found on the same host, only record as backlog if unrelated to the active objective.
- Full auto-detection (`/report-bug <ip>:<port>`) is used only when the active objective is empty or for late-round gap checking

- [08 Credential/Pivot Extraction] Tool: `rg`, `curl`
- When accounts/keys/internal IPs are discovered in code/responses, register immediately
MCP: `add_credential`, `add_host`, `update_host`

- [09 Report-ready Output] Tool: local file + MCP
- Per vulnerability: summary, impact, reproduction steps, payload, output
- Screenshots follow the full-screen principle
- Long payloads go in text attachments

- [10 Completion] Tool: MCP
1. `update_checklist(enumStatus="done", exploitStatus="done")`
2. `log_session_entry(type="result", content="Web run complete")`
3. `heartbeat`
4. `get_sitrep`

## Human Delegation Rule
Immediately use `request_task` for:
- Full port scan (`nmap -p-`)
- Long-running brute-force/cracking
- Steps requiring an interactive PTY

## Stop / Handoff Rule
- If no state transition point (privilege bypass, download, internal clue, confirmed vulnerability) is found within 15 minutes, record the reason for being stuck with `add_note` and move to the next web host or `solve-ad` lane `within the same objective`.
- Do not ask the user to choose a host.
