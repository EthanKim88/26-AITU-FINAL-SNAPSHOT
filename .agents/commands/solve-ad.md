---
description: Active Directory autonomous exploitation skill (Claude skill) execution wrapper.
---

# /solve-ad

`/solve-ad <dc_ip> [domain] [user:pass]`

Behavior:
1. Loads `.claude/skills/solve-ad/SKILL.md`.
2. Parses arguments using `argument-hint` rules.
3. Executes the steps from the SKILL document as-is (including session/checklist/MCP logging).
