---
name: risk-autopilot
description: "AITU Final autonomous orchestrator. Use when the user says continue, keep going, do the next thing, or gives no target context. Read MCP state, lock onto one active risk objective, and dispatch scanning, web, AD, pivot, SCADA, and reporting without asking the user to choose a host or risk."
argument-hint: "[goal override]"
---

# AITU Final Risk Autopilot

Goal override: `$ARGUMENTS`

## Reference
- `./references/action-selection.md`
- `./references/objective-lock.md`
- `./references/risk-priority.md`
- `/.idea/risk-strategy.md`

## Tool Path Index

```bash
ROOT="."  # repository root
STATE="$ROOT/scripts/util/objective_state.sh"
STATE_FILE="$ROOT/.agents/state/active_objective.json"
```

## Core Rule
- Do not stop even if the user does not specify a host, domain, or risk name.
- First read the current state from `MCP`, lock onto `one primary Risk`, and then autonomously select the next action that advances that Risk.
- Execution takes priority over questions. Questions are only allowed at `manual-only` steps or when there are absolutely no clues in MCP.
- Lanes may change, but the objective does not change easily.

## Objective Lock (Mandatory)
- Always maintain only one `active risk objective`.
- If an active objective exists, all next actions are selected solely based on the criterion `does this action advance the current Risk`.
- Even when new clues emerge, do not switch immediately. If they are not directly connected to the current Risk, record them only in `backlog`.
- The reference state for the active objective is maintained via `scripts/util/objective_state.sh`.
- When locking an objective:
  - `scripts/util/objective_state.sh set "<risk>" "<lane>" "<reason>"`
  - `log_session_entry(type="decision", content="objective-lock: risk=<name>; lane=<lane>; reason=<why>")`
- On session resume, first check `scripts/util/objective_state.sh get`; only when it is empty, refer to `resume_session(sessionId)` or recent session entries.
- Objective switching is only allowed under the switch conditions in `./references/objective-lock.md`.

## Mandatory OODA
1. `start_session(title="Risk Autopilot")` or reuse an existing session
2. `get_sitrep`
3. If `nextActions` or `pending` actions exist, `claim_action` the highest priority one
4. Execute
5. `complete_action(done|failed, result)`
6. `heartbeat`
7. Repeat

Before host-level work:
- `claim_host`
- Checklist order: `enum -> exploit -> privesc`

## Decision Ladder

### 1. Recover or set active objective
- First restore the active objective with `scripts/util/objective_state.sh get`.
- If the state file is empty, pick `the highest-scoring Risk that can be completed soonest` based on `risk-priority` and MCP state, and immediately `set` it.
- If the state file and session entry conflict, the state file takes precedence.

### 2. Pending action first
- If there are tasks in `get_sitrep.nextActions` or `list_actions(status="pending")`, pick those first.
- Skip actions/hosts that are already `in_progress`.
- However, if the action is not directly related to the active objective, record it with `scripts/util/objective_state.sh backlog "<action>" "<why unrelated>"` and prioritize actions matching the current objective.

### 3. No hosts in needed reachable segment -> bootstrap scan
- If there are no hosts yet in the reachable segment needed to advance the active objective, scan first with `uv run scripts/recon/scan_and_import.py -t <cidr>`.
- The default starting point is `DMZ`.
- Even if the user does not specify a CIDR, automatically select an unexplored segment among the reachable segments needed for the active objective.

### 4. Active objective needs web -> `solve-web`
- If the active objective is `Railway Ticket`, `Source code`, `Contracts`, `Prediction market`, `Healthcare dump`, or the web foothold stage of an AD/SCADA chain, send to `solve-web`.

### 5. Active objective needs AD -> `solve-ad`
- If the active objective is `CORP`, `DEV`, `HACKCITY`, `backup server`, or the AD stage for Hackcity/OT access, send to `solve-ad`.

### 6. Active objective needs pivot -> `pivot`
- If a segment needed for the active objective is in an unreachable state, and SSH credentials/dual-home hints/pivot candidate hosts are visible, use `pivot`.
- Maintain priority order: `ligolo-ng > ssh -D > chisel`

### 7. Active objective needs SCADA -> `solve-scada`
- If the active objective is a SCADA Risk, send only assets directly connected to the objective behind Hackcity or the OT bridge to `solve-scada`.

### 8. Evidence complete -> report
- If the active objective chain is complete and objective achievement evidence exists, use `report-risk`
- Bug Bounty is `same-chain only`. Use `report-bug` only when it is a byproduct of the same host/same path while advancing the current objective
- After `report-risk` finishes, run `scripts/util/objective_state.sh clear "report-ready"` and then pick the next objective.

### 9. Stuck -> rotate lane, not objective
- If there is no state transition signal within 15 minutes, record the reason for being stuck with `add_note` and `log_session_entry`, update with `scripts/util/objective_state.sh lane "<next-lane>" "<why>"`, and move to the next lane within the same objective.
- Do not ask the user "Where should we look?"

## Dispatch Rules
- `uv run scripts/recon/scan_and_import.py -t <cidr> [--deep]`: bootstrap for reachable segments needed by the active objective
- `solve-web`: web foothold or web/data Risk for the current objective
- `solve-ad`: domain/Windows stage for the current objective
- `pivot`: extend access to unreachable segments needed by the current objective
- `solve-scada`: SCADA stage for the current objective
- `report-risk`: submit the active objective
- `report-bug`: only BB from the same chain as the active objective

## Ask The User Only When
- GUI/TTY/browser manual operation is required
- Long cracking/full port scan where `request_task` is appropriate
- An external secret value is needed that exists neither in MCP nor locally

Outside of these cases, proceed with fully autonomous judgment.
