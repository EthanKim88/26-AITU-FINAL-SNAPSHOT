---
description: Autonomous execution wrapper that locks the active risk objective and auto-selects the next lane.
---

# /risk-autopilot

`/risk-autopilot [goal override]`

Behavior:
1. Loads `.claude/skills/risk-autopilot/SKILL.md`.
2. Restores or newly locks the active objective.
3. Reads MCP state and selects the next lane matching the current objective from `scan -> web -> ad -> pivot -> scada -> report`.
