---
description: Risk report creation/update skill execution wrapper.
---

# /report-risk

`/report-risk [report_id|risk_name]`

Behavior:
1. Loads `.claude/skills/report-risk/SKILL.md`.
2. If no argument is provided, the active objective is used by default.
3. Performs Description, attachments, and report create/update based on MCP data and the web app API.
