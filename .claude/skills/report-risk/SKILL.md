---
name: report-risk
description: "Automatic Risk report generation. Auto-infers the target from a Report ID, risk name, or the current MCP attack chain context to generate a Description, register in the web app, and save attachments."
argument-hint: "[report_id|risk_name]"
---

# Risk Report Generator

Target Report ID or Risk name: `$ARGUMENTS` (if empty, auto-infer from MCP context)

## Reference
- `/.claude/skills/risk-autopilot/references/objective-lock.md`
- `/scripts/util/objective_state.sh`
- `/scripts/report/templates/report.md.template`
- `/scripts/report/templates/steps.py.template`

---

## Execution Procedure

### Phase 0: Automatic Target Risk Determination

If `$ARGUMENTS` is empty, automatically determine using the following order.

1. Read the risks list with `curl -s http://localhost:10000/api/report/risks`.
2. First read the structured active objective with `scripts/util/objective_state.sh get`; if it exists, use it preferentially.
3. Only when a structured active objective does not exist, refer to the current session's `objective-lock` entry.
4. Only when there is still no active objective, scan MCP's recent host/loot/note/event/session entries to find `the chain with the most complete objective achievement evidence`.
5. If there are multiple candidates, prioritize:
   - Risks with explicit objective achievement evidence
   - Higher scores
   - Risks that do not already have a report
6. If still ambiguous, do not ask the user to choose.
   - `log_session_entry(type="analysis", content="report-risk not ready: ambiguous target")`
   - Record the evidence that needs reinforcement and terminate.

### Phase 1: Risk Information Query

1. Query the risks list from the web app API:
   ```bash
   curl -s http://localhost:10000/api/report/risks
   ```
2. If `$ARGUMENTS` is a number, find the risk by `reportId`; if a string, find by `name`.
3. If `$ARGUMENTS` is empty, use the risk selected in Phase 0.
4. If still not found, output error and terminate.
5. Record the risk's `id` (DB ID), `name`, `description`.
6. `description` is the **achievement objective** of the Risk.

### Phase 2: Collect Related Data from MCP

Collect attack chain data from the following MCP resources.

1. **Hosts**: `ctf://hosts` -- target IP, OS, port information
2. **Credentials**: `ctf://credentials` -- credentials used in the attack
3. **Loot**: `ctf://loot` -- extracted files (config, source code, etc.)
4. **Notes**: `ctf://notes` -- attack process records

Filter related data using Risk name keywords (hostname, IP, service name).
When possible, reconstruct the actual attack sequence from recent session entries and the timeline.

### Phase 3: Generate `report.md`

**Competition scoring requirements**:
> Steps to reproduce: provide clear, technical, step-by-step instructions.
> All risks require a full chain walkthrough covering the entire path from the beginning.
> Omit unnecessary details.
> Provide exact payloads and HTTP requests as a Proof of Concept (PoC).

Follow these requirements strictly, but **the default deliverables going forward are `report.md` + `steps.py` (2 files)**.

Core principles:
- `report.md` is the submission/web app body. Its content is also placed directly into `descriptionMd`.
- `steps.py` is the reproduction entry point. A single `python3 steps.py` invocation should reproduce the entire chain, or at minimum bundle core step-by-step actions and artifact generation.
- Helper files can be added if absolutely necessary, but the legacy `description.md` + multiple `step_*.sh` fan-out layout is not used as the default for new reports.
- If templates are needed, use `/scripts/report/templates/report.md.template` and `/scripts/report/templates/steps.py.template` as starting points.
- Reference examples: `reports/10.10.13.15_risks_buying_a_critical_company_report/`, `reports/10.10.13.15_risks_proprietary_software_source_code_leakage/`.

`report.md` format:

## Description
<1-2 lines: what was achieved and how>

The replay script for this report is `python3 steps.py`. It reproduces the chain below and saves any supporting artifacts in this directory.

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

## Step N - <Title> - Objective Achieved
- <Risk objective achievement proof>
- Relevant URL, request, or artifact: `<actual value>`

Output:

```text
<proof output key 1-3 lines>
```

## Result
- <Final achievement result>
- <Key impact/artefact>

**Writing rules**:
- Steps must be written with `## Step N - <title>` headings, and for Risk, describe the full chain in order from start to objective achievement.
- The beginning of `report.md` must include the sentence `The replay script for this report is `python3 steps.py`.`
- Each Step ends with 1-3 short bullets and a short output block. Reduce verbose narration and unnecessary background explanations.
- **Tool installation**: Steps requiring external tools (impacket, noPac, hashcat, etc.) should have a 1-line install command in the `## Prerequisites` section.
- Long exploit code, raw HTTP, and helper functions are separated into `steps.py` or a separate helper file; only the necessary URL/command/decisive output remains in `report.md`.
- `steps.py` prints progress in `[Step N]` format and saves JSON/TXT/BIN evidence generated during reproduction to the current directory.
- **Exact payloads**: Use actual values for IP, credentials, ports, etc. Placeholders like `ATTACKER_IP` are prohibited.
- **HTTP requests**: Write curl commands and URLs in an actually executable form.
- Clearly prove Risk objective achievement in the last Step.
- Use only values actually recorded in MCP/loot/session evidence for commands and values.
- Include credentials without masking.
- Write in English.

### Phase 4: Determine Target IP

Determine the representative IP of the target host from the attack chain.
- Identify from Risk name or MCP host data
- For dual-homed hosts, use the externally accessible IP (e.g., DMZ IP)

### Phase 5: Automatic Attachment Saving

Directory: `reports/{target_ip}_risks_{risk_or_report_id}/`

Auto-generate and save the following files:

1. **`report.md`** - Full submission body generated in Phase 3

2. **`steps.py`** - Single reproduction entry point
   - Reproduces the entire chain or performs core steps in sequence with `python3 steps.py`.
   - Helper files (`*_common.py`, payload, JSON seed, etc.) can be added if needed.
   - Even with helpers, the public reproduction entry point in `report.md` is basically kept to a single `steps.py`.

3. **Optional helper / artifact files**
   - exploit payload, helper module, extracted source/config/db excerpt, PDF, JSON, TXT, etc.
   - Keep only files directly needed for reproduction or result proof.

4. **Submission ZIP package preparation** - All deliverables except images are bundled into a ZIP.
   - Competition-allowed attachments: images, PDF, TXT, LOG, MD, JSON, CSV, ZIP, GZ, 7Z
   - Screenshots/images are full-screen evidence and are kept as separate files, not placed in the ZIP.
   - `report.md`, `steps.py`, helper files, source/config/db excerpts, md/json/csv/pdf are included in `attachments.zip`.
   - `output.txt` and simple command output logs are not attached. Key output should already be in the Description.
   - Each attachment must be under 10MB. If exceeded, create multiple ZIPs (`attachments_part1.zip`, `attachments_part2.zip`) rather than a split archive.
   - Loose files are kept in `reports/.../` for reproducibility review.
   - **The source of truth for manual submission is `loots/reports/<report_id>/`.**

### Phase 6: Register/Update Report in Web App

1. Check for existing reports:
   ```bash
   curl -s http://localhost:10000/api/reports
   ```
   - If a report already exists for that riskId -> **Find that report's exact `id` and PATCH it**
   - If not -> POST to create a new one

2. Create/Update:
   ```bash
   # Create new
   curl -s -X POST http://localhost:10000/api/reports \
     -H "Content-Type: application/json" \
     -d '{"reportType":"risk","riskId":"<DB_ID>","descriptionMd":"<MD>","status":"pending"}'

   # Update existing
   curl -s -X PATCH http://localhost:10000/api/reports/<report_id> \
     -H "Content-Type: application/json" \
     -d '{"descriptionMd":"<MD>"}'
   ```
   - **Important**: Do not include `status` in the PATCH. Unless explicitly changing the status, the existing `submit/accept/reject` status must be preserved.
   - If there are multiple reports for the same `riskId`, do not overwrite manually submitted/judged reports (`submit`, `accept`); use the `report_id` of the currently in-progress draft.

3. After creation/update, once the platform `<report_id>` is confirmed, create the manual submission loot package.
   ```bash
   ARTIFACT_DIR="reports/<target_ip>_risks_<risk_or_report_id>"
   python3 scripts/report/package_attachments.py \
     "$ARTIFACT_DIR" \
     --report-id "<report_id>"
   ```
   - ZIP source: `$ARTIFACT_DIR/attachments*.zip`
   - Manual submission path: `loots/reports/<report_id>/`
   - Submission file list: `loots/reports/<report_id>/SUBMISSION_FILES.md`
   - ZIP evidence: `loots/reports/<report_id>/attachments*.zip`
   - Image evidence: `loots/reports/<report_id>/images/`
   - manifest: `loots/reports/<report_id>/attachments_manifest.json`

### Phase 7: Result Output

```
Risk Report Complete
- Risk: <risk_name> (report id: <platform_report_id>)
- Objective: <risk_description>
- Steps: <N>
- Attachments: reports/<target_ip>_risks_<risk_or_report_id>/
  - report.md
  - steps.py
  - optional helper/evidence files
  - attachments.zip
- Manual Submission Path: loots/reports/<report_id>/
  - SUBMISSION_FILES.md
  - attachments*.zip
  - images/
  - attachments_manifest.json
```

---

## Rules

- Web app: `http://localhost:10000`
- If MCP data is insufficient -> mark with `[TODO]`
- Report status: `pending` (submission is manual)
- If `$ARGUMENTS` is empty, attempt auto-inference first
- **No separate token scoring**: Achieving the Risk `description` objective is the sole evaluation criterion
- **Reproducibility first**: The judge must be able to reproduce by copy-pasting the commands
- **Default reproduction entry point is a single `steps.py`**: New reports use `report.md` + `steps.py` compact layout as default.
- Helper files are needed are allowed, but the legacy `description.md` + `step_*.sh` fan-out is not used as the default for new reports unless it is a maintenance target.
- **Attachment limits**: Non-image deliverables go in `attachments*.zip`, screenshots go in `images/`. Manual submission follows `loots/reports/<report_id>/SUBMISSION_FILES.md`.
- **Pivots/tunnels should reflect the actual chain used**: If internal network access was needed, reflect the actual tunnel mode used during the attack (`ligolo-ng`, `chisel`, `ssh -D`) directly in `report.md` and `steps.py`. Runtime priority is `ligolo-ng > chisel > ssh -D`; include `proxychains4 -q` only if the chain used SOCKS. Do not rewrite to a different tunnel method for convenience.
- Even if the user does not decide which Risk report to write, prioritize writing the active objective.
- After completing the active objective's attachments and description, clear the objective with `scripts/util/objective_state.sh clear "report-ready"`.
