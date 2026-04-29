# Objective Lock

## Goal
- The AI always maintains only one `active risk objective`.
- Prioritize `finishing one thing` over `touching many things`.

## Structured State (Mandatory)
- The reference state for the active objective is `.agents/state/active_objective.json`.
- Read/write helper:
  - `scripts/util/objective_state.sh get`
  - `scripts/util/objective_state.sh set "<risk>" "<lane>" "<reason>"`
  - `scripts/util/objective_state.sh lane "<lane>" "<reason>"`
  - `scripts/util/objective_state.sh backlog "<lead>" "<reason>"`
  - `scripts/util/objective_state.sh clear "<reason>"`
- `log_session_entry` is an audit log. It does not replace structured state.
- When an active objective is set, immediately record both:
  - `scripts/util/objective_state.sh set "<risk>" "<lane>" "<reason>"`
  - `log_session_entry(type="decision", content="objective-lock: risk=<name>; lane=<lane>; reason=<why>")`
- On session resume:
  - First check `scripts/util/objective_state.sh get`
  - Only when it is empty, refer to `resume_session(sessionId)` or recent session entries.
- Unrelated new opportunities are recorded only as backlog:
  - `scripts/util/objective_state.sh backlog "<host|risk|lead>" "<why not now>"`
  - `log_session_entry(type="note", content="objective-backlog: <host|risk|lead>; reason=<why>")`

## What Counts As "Advances Current Objective"
- Steps that directly achieve the same Risk
- Foothold, credential, pivot, oracle, or report evidence needed for the same Risk
- Bug Bounty byproducts from the same host/same exploit chain on the same Risk path

## What Goes To Backlog Instead
- New web hosts not directly connected to the current Risk
- Interesting services in a different segment
- Separate Bug Bounties that are not needed to solve the current Risk
- Vague additional exploration that is not a direct path

## Allowed Objective Switch Conditions
The objective is changed only when one of the following conditions is met.

1. **Completed**
- Current Risk is in report-ready or submitted state
- If `report-risk` has generated attachments and description, the objective can be cleared with `scripts/util/objective_state.sh clear "report-ready"` and then move to the next objective

2. **Hard blocked**
- No signal after 15-20 minutes even after switching lanes within the same Risk
- The needed segment/credential/oracle is completely unavailable at present

3. **Direct high-value jump**
- A `direct credential`, `direct pivot`, or `direct oracle` to a higher-scoring Risk is newly obtained
- Example: `hackcity.local` direct domain cred obtained

4. **Manual-only pause**
- GUI/TTY/manual task is needed and the current Risk cannot be continued immediately

## Explicit Non-switch Conditions
- Simply discovering a more interesting-looking host
- A simple Bug Bounty possibility
- Discovering a single hint for another Risk
- The current Risk chain is still alive

## Lane Rotation Rule
- The objective is maintained
- Only the lane can rotate:
  - `web -> ad -> pivot -> scada -> report`
- Record the rotation reason:
  - `scripts/util/objective_state.sh lane "<to>" "<why>"`
  - `log_session_entry(type="decision", content="objective-lane-shift: risk=<name>; from=<a>; to=<b>; reason=<why>")`

## Bug Bounty Rule
- `same-chain only`
- Immediately claim only BB from the same host/same service/same exploit chain of the current objective
- Otherwise, record only as backlog
