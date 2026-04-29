---
description: SCADA/ICS autonomous exploitation skill (Claude skill) execution wrapper.
---

# /solve-scada

`/solve-scada <target_ip> [port=502]`

Behavior:
1. Loads `.claude/skills/solve-scada/SKILL.md`.
2. Parses arguments using `argument-hint` rules.
3. Executes the steps from the SKILL document as-is (protocol identification/register analysis/flag processing/MCP logging).
