# MCP Action Selection

## Rule
- If sufficient clues are visible in `MCP`, do not ask the user to select a target.
- First check if there is an `active objective` with `scripts/util/objective_state.sh get`. If so, prioritize objective relevance over tie-breaking.
- Only when there is no objective, select based on `score x reachability x current evidence completeness`.

## State -> Next Skill

| MCP State | Next Skill | Reason |
|---|---|---|
| No active objective | Select objective | Lock onto a target first |
| No hosts in the reachable segment needed for the active objective | `uv run scripts/recon/scan_and_import.py -t <cidr> [--deep]` | Bootstrap |
| Active objective is at web/data or web foothold stage | `solve-web` | Advance the current Risk |
| Active objective is at domain/Windows stage | `solve-ad` | Seize the backbone |
| Active objective needs an unreachable segment | `pivot` | Extend access |
| Active objective is at SCADA stage | `solve-scada` | Advance the high-scoring Risk |
| Active objective evidence is sufficient | `report-risk` | Submit before score decay |
| Same-chain Bug Bounty is verified | `report-bug` | Immediately claim the byproduct |

## Tie-break
0. Does it directly advance the active objective
1. Already reachable segment
2. High-scoring Risk with large score decay
3. Path likely to produce results within 15 minutes
4. Path that can reuse existing loot/creds

## Rotation Rule
- 15 minutes with no signal: move to the next lane `within the same objective`
- Unrelated candidates are recorded only with `scripts/util/objective_state.sh backlog ...`
- `web -> ad -> pivot -> scada -> report` rotation is repeated only within the objective
