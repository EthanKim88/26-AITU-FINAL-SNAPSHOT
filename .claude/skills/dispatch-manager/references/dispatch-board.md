# Dispatch Board

## Purpose
- The `dispatch board` is a local state file where the manager shares worker assignments and statuses.
- The source of truth is separated as follows.
  - objective: `scripts/util/objective_state.sh`
  - worker assignments/status: `scripts/util/dispatch_board.sh`

## File
- board file: `.agents/state/dispatch-board.json`
- helper: `scripts/util/dispatch_board.sh`

## Minimal Shape
```json
{
  "objective": "#4 Railway Ticket",
  "phase": "wave1-web",
  "updatedAt": "2026-04-24T01:00:00Z",
  "workers": {
    "codex-1": {
      "role": "web-main",
      "status": "assigned",
      "risk": "#4 Railway Ticket",
      "lane": "web",
      "target": "10.10.13.8:443 booking app",
      "goal": "find confirm/callback path",
      "whyNow": "fastest independent solve candidate",
      "stopIf": "no state transition in 10m",
      "handoffIf": "internal credential found",
      "evidenceNeeded": "raw HTTP + final booking object",
      "summary": "",
      "updatedAt": "2026-04-24T01:00:00Z"
    }
  },
  "backlog": []
}
```

## Helper Commands
```bash
scripts/util/dispatch_board.sh get
scripts/util/dispatch_board.sh init
scripts/util/dispatch_board.sh set-phase "wave1-web"
scripts/util/dispatch_board.sh sync-objective "#4 Railway Ticket"
scripts/util/dispatch_board.sh reap-stale "900"
scripts/util/dispatch_board.sh assign \
  "codex-1" "web-main" "#4 Railway Ticket" "web" \
  "10.10.13.8:443 booking app" \
  "find confirm/callback path" \
  "fastest independent solve candidate" \
  "no state transition in 10m" \
  "internal credential found" \
  "raw HTTP + final booking object"
scripts/util/dispatch_board.sh status "codex-1" "blocked" "no callback endpoint after 10m"
scripts/util/dispatch_board.sh clear-worker "codex-1"
scripts/util/dispatch_board.sh backlog "possible gitea at 10.10.13.11:3000" "support lead only"
```

## Status Values
- `assigned`
- `in_progress`
- `done`
- `blocked`
- `idle`

The manager may use `assigned` and `in_progress` interchangeably if needed, but at minimum `done` and `blocked` must be distinguished.

## Stale Handling
- Use `scripts/util/dispatch_board.sh reap-stale 900` to clean up workers that have not been updated for more than 15 minutes.
- `sync-objective` clears existing worker assignments when the objective changes.
