# Worker Protocol

## Goal
Workers report briefly to the manager, and the manager immediately returns the next task.

## Preferred Worker Messages

### Idle / next
```text
worker=codex-1
status=idle
summary=ready
request=next
```

### Done
```text
worker=claude-2
status=done
summary=Found /api/booking/confirm and /api/payment/callback
request=next
```

### Blocked
```text
worker=codex-3
status=blocked
summary=shipping portal exists but no object/file path in 10m
request=next
```

### High-value finding
```text
worker=claude-1
status=high-value-finding
summary=Found hackcity.local operator credential in deploy inventory
request=re-evaluate objective
```

### Periodic rebalance
```text
dispatch sync
```

## Manager Response Format
The manager prioritizes assignments over explanations.

```text
worker: codex-1
risk: #4 Railway Ticket
lane: web
target: 10.10.13.8:443 booking app
goal: find confirm/callback path that confirms booking with zero charge
why now: current objective is nearly solvable and highest speed-to-score candidate
stop if: no reproducible state transition in 10 minutes
handoff if: any internal credential, repo token, or ftech.local host is found
evidence needed: raw HTTP sequence and final booking object
```

## Escalation Triggers
The following require the manager to re-evaluate immediately.
- Plaintext credentials obtained
- Repo/source leak confirmed
- Internal segment access gained
- `hackcity.local` lead discovered
- Two SCADA oracles obtained simultaneously
- Report-ready evidence obtained
