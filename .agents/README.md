# Codex Compatibility Layer

This directory is a bridge for using the existing Claude configuration (`CLAUDE.md`, `.claude/skills`) identically in Codex.

Structure:
- `../AGENTS.md`: Root Codex rule file (synced copy of CLAUDE.md + command mappings)
- `.claude/skills/*/SKILL.md`: Actual source of truth
- `.agents/commands/*.md`: Codex command wrappers. Each wrapper points to the corresponding `.claude/skills/*/SKILL.md`.
