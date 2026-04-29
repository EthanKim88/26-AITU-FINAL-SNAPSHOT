---
description: Web/DMZ autonomous exploitation skill (Claude skill) execution wrapper.
---

# /solve-web

`/solve-web <target_ip> [port=80]`

Behavior:
1. Loads `.claude/skills/solve-web/SKILL.md`.
2. Parses arguments using `argument-hint` rules.
3. Executes the steps from the SKILL document as-is (source collection/code analysis/exploitation/MCP logging).
