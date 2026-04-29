---
name: report-bug
description: "Automatic Bug Bounty report generation. Collects MCP data from report_id, host_ip:port, or host_ip:port bug_type, generates Description, registers/updates via web app, and saves attachments."
argument-hint: "<report_id> | <ip:port> | <ip:port> <bug_type>"
---

# Bug Bounty Report Generator

Arguments: `$ARGUMENTS`

## Reference
- `/.claude/skills/risk-autopilot/references/objective-lock.md`
- `/scripts/util/objective_state.sh`
- `/scripts/report/templates/report.md.template`
- `/scripts/report/templates/steps.py.template`

**3 modes**:

| Invocation Example | Mode | Behavior |
|-----------|------|------|
| `/report-bug cmo9zqm` | **ID** | Update the Description of an existing report |
| `/report-bug 10.10.110.21:80` | **Host** | Scan MCP data -> auto-detect vulnerabilities not in existing reports -> generate report |
| `/report-bug 10.10.110.21:80 SQLi` | **Host+Type** | Generate report directly with the specified Bug Type |

## Scoring Priority (MUST)
- Bug Bounty has a host cap (1500) and submission timing matters, so **first-claim speed is the priority**
- Default strategy: generate/update report immediately with `Host+Type`, then refine details in follow-up
- Do not delay submission even if MCP data is partially incomplete; PATCH with minimum reproduction info first
- Auto-detection `Host` mode is used for late-round gap checking
- However, while an active risk objective exists, `same-chain only` applies.
- Immediately claim only when it is a byproduct of the same host/same exploit chain as the current objective.
- Bug Bounties unrelated to the current objective are recorded only as backlog without breaking the objective.

---

## Execution Procedure

### Phase 0: active objective gate

1. First read the active objective with `scripts/util/objective_state.sh get`.
2. If an active objective exists, enforce `same-chain only`.
   - Only allow the same host, same service, same exploit path, or byproducts that advance the current objective
   - For all other Bug Bounties: `scripts/util/objective_state.sh backlog "<ip>:<port> <bug>" "bug is out-of-chain"`
3. Unless the user explicitly instructs an out-of-chain Bug Bounty, do not break the objective in autonomous calls.

### Phase 1: Argument Parsing & Report Acquisition

#### Mode Determination
```
args = $ARGUMENTS.split(' ')

if args[0] contains ':':
  ip, port = args[0].split(':')
  if args[1] exists:
    -> Host+Type mode (ip:port + bug_type_name)
  else:
    -> Host mode (ip:port, auto-detect)
else:
  -> ID mode (report_id prefix)
```

#### A) ID Mode -- Update Existing Report

1. Query the report from the web app API:
   ```bash
   curl -s http://localhost:10000/api/reports
   ```
2. Find a report whose `id` starts with `$ARGUMENTS` (prefix match).
3. If not found, output error and terminate.
4. If `reportType` is not `bug_bounty`, output error and terminate.
5. If `bugTypeId` is missing, error: "Please select a Bug Type in the web app first."
6. If `targetIp` is empty, error: "Please enter a Target IP in the web app first."
7. Record the report's `id`, `bugTypeId`, `targetIp`, `bugType.name`, `bugType.points`.

-> Proceed to Phase 2.

#### B) Host+Type Mode -- Generate Report with Specified Bug Type

1. Parse `ip:port` and `bug_type_name`.
2. If an active objective exists and the given `ip:port bug_type_name` is not same-chain:
   - `scripts/util/objective_state.sh backlog "<ip>:<port> <bug_type_name>" "host+type bug claim is out-of-chain"`
   - Unless the user explicitly overrides, do not auto-generate and terminate.
3. Query the bug type list from the web app:
   ```bash
   curl -s http://localhost:10000/api/report/bug-types
   ```
4. Find a bug type whose `name` matches `bug_type_name` (case-insensitive).
   - If no match is found, output error and terminate.
   - **Alias support**: `LFI` -> "Path Traversal / File Inclusion", `CMDi` -> "RCE"
5. Check for duplicate existing reports:
   ```bash
   curl -s "http://localhost:10000/api/reports?reportType=bug_bounty"
   ```
   - If a report with the same `bugTypeId` + `targetIp` exists -> **Use that report's exact `id` as the PATCH target**
   - If not -> POST a new report:
     ```bash
     curl -s -X POST http://localhost:10000/api/reports \
       -H "Content-Type: application/json" \
       -d '{"reportType":"bug_bounty","bugTypeId":"<id>","targetIp":"<ip>","status":"pending"}'
     ```
6. Record the report's `id`, `bugTypeId`, `targetIp`, `bugType.name`, `bugType.points`.
7. **Fast Claim PATCH (immediate)**:
   - Immediately reflect a minimal reproduction body in `descriptionMd` (summary + 1 reproduction command + 1 output)
   - Detailed steps/attachments are refined in subsequent updates (`/report-bug <report_id>`)

-> Proceed to Phase 2.

#### C) Host Mode -- Auto-detect and Generate Report

1. Parse `ip:port`.
2. If an active objective exists and the given `ip:port` is not same-chain:
   - `scripts/util/objective_state.sh backlog "<ip>:<port>" "host-mode bug scan is out-of-chain"`
   - Output "Bug Bounty unrelated to active objective; not auto-generating" and terminate.
3. MCP data collection (same as Phase 2):
   - `ctf://hosts`, `ctf://loot`, `ctf://notes`, `ctf://events`, `ctf://credentials`
   - Filter data related to the given ip (+ port)
4. Query existing report list from the web app:
   ```bash
   curl -s "http://localhost:10000/api/reports?reportType=bug_bounty"
   ```
   - Extract the **list of Bug Type IDs already reported** for that `targetIp`
5. Analyze MCP data to detect **only same-chain vulnerabilities not yet reported**:
   - Check exploit success records in notes/events
   - Check extracted data types in loot (db-dump -> SQLi, source-code -> analysis)
   - Check acquisition methods in credentials
   - If an active objective exists, keep only findings connected to hosts/services/credentials directly mentioned in the objective chain.
   - Map each finding to a Bug Type:
     - `system(`, `exec(`, webshell, reverse shell -> **RCE**
     - sudo privesc, SUID, capabilities -> **LPE**
     - SQL injection, union select, db dump -> **SQLi**
     - template injection, `{{}}` -> **SSTI**
     - XML external entity -> **XXE**
     - internal service access, SSRF -> **SSRF**
     - file read, `../`, LFI -> **Path Traversal / File Inclusion**
     - other user data, broken access -> **IDOR**
6. **Skip** already reported Bug Types.
7. If there are same-chain vulnerabilities not yet reported:
   - Select the **highest-scoring same-chain** Bug Type
   - POST a report for that Bug Type
   - List remaining unreported vulnerabilities in the result output
8. If no new vulnerabilities to report:
   - Output "No new vulnerabilities found for this host+port." and terminate.

-> Proceed to Phase 2 (reuse already collected MCP data).

---

### Phase 2: Collect Related Data from MCP

For Host mode (C), data was already collected, so reuse it. For ID/Host+Type modes, collect here.
Speed first: For Host+Type fast claim, query `events/loot` first; `notes/credentials/hosts` can be expanded in subsequent refinement.

1. **Hosts**: `ctf://hosts` -- ports and OS information for the targetIp
2. **Credentials**: `ctf://credentials` -- credentials used/discovered on the host
3. **Loot**: `ctf://loot` -- files extracted from the host (source code, config, DB dump, etc.)
4. **Notes**: `ctf://notes` -- analysis notes related to the host
5. **Events**: `ctf://events` -- exploit events for the host

Filter related data by targetIp and bugType.name.

### Phase 3: Generate `report.md`

**Competition scoring requirements**:
> Steps to reproduce: provide clear, technical, step-by-step instructions.
> Provide exact payloads and HTTP requests as a Proof of Concept (PoC).
> Omit unnecessary details.

Bug Bounty is a **PoC for a single vulnerability**. Unlike Risk, a full chain is not needed.

The default deliverables for a new report are **`report.md` + `steps.py`** (2 files).

Core principles:
- `report.md` is the submission/web app body. Its content is also placed directly into `descriptionMd`.
- `steps.py` is the PoC reproduction entry point. As much as possible, bundle vulnerability verification and evidence generation into a single `python3 steps.py` invocation.
- Helper files can be added if absolutely necessary, but the legacy `description.md` + multiple `step_*.sh` fan-out layout is not used as the default for new reports.
- If templates are needed, use `/scripts/report/templates/report.md.template` and `/scripts/report/templates/steps.py.template` as starting points.

`report.md` format:

## Description
<2-3 line vulnerability summary: what, where, and why it is vulnerable>

The replay script for this report is `python3 steps.py`. It reproduces the PoC below and saves any supporting artifacts in this directory.

## Prerequisites
- `apt install <tool>` or `pip install <tool>`
- Omit this section if none

## Step 1 - <Title>
- <1-2 line description>
- Relevant URL or command: `<actual URL, request, or python3 steps.py>`

Output:

```text
<key actual output 1-3 lines>
```

## Step 2 - <Title>
- <1-2 line description>
- Relevant URL, request, or artifact: `<actual value>`

Output:

```text
<key actual output 1-3 lines>
```

## Step N - Vulnerability Confirmed
- <Vulnerability proof result>
- Relevant URL, request, or artifact: `<actual value>`

Output:

```text
<proof output key 1-3 lines>
```

## Result
- <Key result summary>

**Bug Type proof criteria**:

- **LPE**: RCE obtained + privilege escalation -> `id`/`whoami` + `ip addr`/`ifconfig` as root/SYSTEM
- **RCE**: Remote command execution -> `id`/`whoami` + `ip addr`/`ifconfig`
- **SQLi**: DB data extraction or authentication bypass
- **SSTI**: Code execution in template engine (e.g., `{{7*7}}` -> `49`)
- **XXE**: File read or SSRF via external entity
- **SSRF**: Internal service/port access
- **Path Traversal / File Inclusion**: File read outside the web root
- **IDOR**: Access to another user's data

**Writing rules**:
- Each Step ends with a short description + relevant URL/command + short output block.
- Steps must be written with `## Step N - <title>` headings.
- The beginning of `report.md` must include the sentence `The replay script for this report is `python3 steps.py`.`
- Complex exploit code, raw HTTP, and helper functions are separated into `steps.py` or a separate helper file; only the decisive URL/command/result remains in `report.md`.
- `steps.py` prints progress in `[Step N]` format and saves responses/JSON/TXT generated during reproduction to the current directory.
- Exact payloads: use actual IP, port, and credentials (no placeholders)
- Write curl commands and URLs in an actually executable form.
- No credential masking
- Write in English
- Add a `## Prerequisites` section when external tools are needed
- Unlike Risk, a full chain is unnecessary -- describe **only the PoC for the vulnerability**

### Phase 4: Automatic Attachment Saving

Directory: `reports/{target_ip}_bugs_{bug_type_name_lower}/`
- bug type name: lowercase, spaces replaced with underscores (e.g., `path_traversal`)

Auto-generate the following files:

1. **`report.md`** -- Full submission body generated in Phase 3

2. **`steps.py`** -- Single PoC reproduction entry point
   - Runs core verification and evidence generation flow with `python3 steps.py`.
   - Helper files can be added if needed, but the public reproduction entry point is basically kept to a single `steps.py`.

3. **Optional helper / artifact files**
   - exploit payload, helper module, extracted source/config/db excerpt, JSON/TXT/PDF, etc.
   - Keep only files directly needed for reproduction or result proof.

4. **Submission ZIP package** -- All deliverables except images are bundled into a ZIP.
   - Competition-allowed attachments: images, PDF, TXT, LOG, MD, JSON, CSV, ZIP, GZ, 7Z
   - Screenshots/images are full-screen evidence and are kept as separate files, not placed in the ZIP.
   - `report.md`, `steps.py`, helper files, source/config/db excerpts, md/json/csv/pdf are included in `attachments.zip`.
   - `output.txt` and simple command output logs are not attached. Key output should already be in the Description.
   - Each attachment must be under 10MB. If exceeded, create multiple ZIPs (`attachments_part1.zip`, `attachments_part2.zip`) rather than a split archive.
   - Loose files are kept in `reports/.../` for reproducibility review.
   - **The source of truth for manual submission is `loots/reports/<report_id>/`.**

   ```bash
   python3 scripts/report/package_attachments.py \
     "reports/<target_ip>_bugs_<type>" \
     --report-id "<report_id>"
   ```

   - ZIP source: `reports/<target_ip>_bugs_<type>/attachments*.zip`
   - Manual submission path: `loots/reports/<report_id>/`
   - Submission file list: `loots/reports/<report_id>/SUBMISSION_FILES.md`
   - ZIP evidence: `loots/reports/<report_id>/attachments*.zip`
   - Image evidence: `loots/reports/<report_id>/images/`
   - manifest: `loots/reports/<report_id>/attachments_manifest.json`

### Phase 5: Web App Report Update

Update the report via PATCH:
```bash
curl -s -X PATCH http://localhost:10000/api/reports/<report_id> \
  -H "Content-Type: application/json" \
  -d '{"descriptionMd":"<MD>"}'
```
- **Important**: Do not include `status` in the PATCH. Unless the purpose is to explicitly change the status, the existing `submit/accept/reject` status must be preserved.

### Phase 6: Result Output

```
Bug Bounty Report Complete
- Report ID: <id> (prefix: <8 chars>)
- Bug Type: <name> (<points>pts)
- Target: <target_ip>:<port>
- Steps: <N>
- Attachments: reports/<target_ip>_bugs_<type>/
  - report.md
  - steps.py
  - optional helper/evidence files
  - attachments.zip
- Manual Submission Path: loots/reports/<report_id>/
  - SUBMISSION_FILES.md
  - attachments*.zip
  - images/
  - attachments_manifest.json

Required Attachments (manual):
- <List items where required=true from requiredRules>

Additional Findings (unreported):
- <List of not-yet-reported Bug Types. Omit if none>
- Example: "SQLi -- generate report with /report-bug 10.10.110.21:80 SQLi"
```

---

## Rules

- Web app: `http://localhost:10000`
- If MCP data is insufficient -> mark with `[TODO]`
- If `$ARGUMENTS` is empty, output error and terminate
- **No submission delay**: If minimum reproduction info exists, claim immediately; completeness refinement comes later
- **No separate token scoring**: Vulnerability proof (PoC) is the sole evaluation criterion
- **Reproducibility first**: The judge must be able to reproduce by copy-pasting the commands
- **Default reproduction entry point is a single `steps.py`**: New reports use `report.md` + `steps.py` compact layout as default.
- Helper files are allowed, but the legacy `description.md` + `step_*.sh` fan-out is not used as the default for new reports.
- **Required attachments by Bug Type**: LPE/RCE require whoami/id + ipconfig screenshots -- indicate this in the result output
- **Attachment limits**: Non-image deliverables go in `attachments*.zip`, screenshots go in `images/`. Manual submission follows `loots/reports/<report_id>/SUBMISSION_FILES.md`.
- **1500 point cap per host**: Multiple bug types can be submitted for the same IP, but the total is capped at 1500 points
- **ID mode**: prefix match -- matchable with 8+ characters
- **Host mode**: Auto-detect Bug Type from MCP data, skip already reported ones (for late-round gap checking)
- **Host+Type mode**: Generate report directly with the specified Bug Type (default mode, fast claim priority)
- **Aliases**: `LFI`->"Path Traversal / File Inclusion", `CMDi`->"RCE", `FileUpload`->"RCE"
