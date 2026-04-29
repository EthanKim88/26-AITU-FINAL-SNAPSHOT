---
description: Multi AI manager/dispatcher skill execution wrapper.
---

# /dispatch-manager

`/dispatch-manager [sync|next|blocked|done|re-evaluate] [worker report]`

Behavior:
1. Loads `.claude/skills/dispatch-manager/SKILL.md`.
2. Parses arguments using `argument-hint` rules.
3. Reads the active objective, dispatch board, and MCP sitrep, then performs worker assignment or reassignment.
