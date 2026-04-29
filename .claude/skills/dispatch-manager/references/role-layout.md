# Role Layout

## Recommended 1 + 7 Layout
- manager: maintain objective, assign workers, deduplicate
- worker 1: web-main
- worker 2: web-support or second web-main
- worker 3: loot-grep / source analysis
- worker 4: ad-main
- worker 5: pivot / hackcity-path
- worker 6: scada-map
- worker 7: report / evidence

## Opening 30 Minutes
- 2 web-main workers
- 1 loot-grep worker
- 1 ad/pivot worker on standby
- 1 report worker on standby
- remaining workers on support validation

## After Credentials or Repo Leak
- 2 ad-main workers
- keep 1 web worker
- keep 1 loot-grep worker
- activate 1 pivot worker
- keep 1 report worker

## After Hackcity Access
- 2 scada-map workers
- keep 1 ad/pivot worker
- 1 report/evidence worker
- remaining workers as facility support scouts

## Reassignment Rules
- Blocked workers are moved only to a different lane within the same objective
- Do not assign more than 2 workers to the same target
- When report-ready status is reached, immediately activate the report/evidence worker
- To prevent weakening the main push, limit support scouts to a maximum of 2
