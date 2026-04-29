---
name: update-risks
description: "Parses a risks.md file and synchronizes it to the web app Report Risks DB (create/update). Reflects report id, name, points, and description."
argument-hint: "[file_path] (default: docs/risks.md)"
---

# Update Risks from Markdown

Source file: `$ARGUMENTS` (if empty, `docs/risks.md`)

---

## File Format

```markdown
## <Risk Name>
- report id : <platform_report_id>
- Points: <number>
- Description: <text>
```

Each `## ` heading represents one Risk entry.

---

## Execution Procedure

### Phase 1: File Reading and Parsing

1. Read the source file using the Read tool.
2. Parse each section starting with `## `:
   - **name**: Text after `## `
   - **reportId**: Text after `- report id : ` (trim)
   - **points**: Number after `- Points: `
   - **description**: Text after `- Description: `
3. If zero items are parsed, output error and terminate.

### Phase 2: Query Existing Risks

1. Call the web app API via Bash:
   ```bash
   curl -s http://localhost:10000/api/report/risks
   ```
2. Get the existing risks list from the response JSON.
3. Map each existing risk by `name` as the key.

### Phase 3: Synchronization (Upsert)

For each parsed item:

**If the same name already exists -> PATCH**:
```bash
curl -s -X PATCH http://localhost:10000/api/report/risks/<db_id> \
  -H "Content-Type: application/json" \
  -d '{"reportId":"<reportId>","name":"<name>","description":"<description>"}'
```

**If not -> POST**:
```bash
curl -s -X POST http://localhost:10000/api/report/risks \
  -H "Content-Type: application/json" \
  -d '{"reportId":"<reportId>","name":"<name>","description":"<description>"}'
```

### Phase 4: Result Summary

Output the processing results as a table:
```
| Action  | Report ID | Name                | Status |
|---------|-----------|---------------------|--------|
| Created | 10        | Domain Infra...     | OK     |
| Updated | 11        | SCADA: Brewery...   | OK     |
```

---

## Rules

- The web app must be running at `http://localhost:10000`.
- If the name is the same, update; if different, create new.
- Existing risks not in the file are not deleted (safe).
- Points are not currently in the Risk model, so include in description or ignore.
