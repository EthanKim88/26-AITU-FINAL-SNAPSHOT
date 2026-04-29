---
description: Bug Bounty report creation/update skill execution wrapper.
---

# /report-bug

`/report-bug <report_id>|<ip:port>|<ip:port> <bug_type>`

Behavior:
1. Loads `.claude/skills/report-bug/SKILL.md`.
2. Parses arguments using `argument-hint` rules.
3. If an active objective exists, only same-chain is allowed; generates/updates the bug report based on MCP data and the web app API.
