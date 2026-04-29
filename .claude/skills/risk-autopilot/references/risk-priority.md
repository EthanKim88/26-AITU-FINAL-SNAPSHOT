# Published Risk Priority

## Wave 1: Quick Web / Data
1. `Railway Ticket System`
2. `Proprietary software source code leakage`
3. `Secret company contracts`
4. `Buying a critical company report`
5. `Healthcare service dump`

Key points:
- Get 1-2 quick approvals
- Obtain internal accounts, DB strings, repo secrets, host/IP clues

## Wave 2: AD Backbone
1. `CORP`
2. `DEV`
3. `HACKCITY`

Key points:
- Use `CORP` as the primary axis
- If repo/deploy secrets are visible, prioritize `DEV` first
- If a direct cred/path to Hackcity exists, prioritize `HACKCITY`

## Wave 3: SCADA
1. `SPORT STADIUM`
2. `Government complex`
3. `BUSINESS CENTER`
4. `OIL DEPOT`
5. `HOSPITAL`
6. `LRT TRAIN`

Key points:
- Solve facility-type risks first for pattern reuse
- `Oil Depot` has a relatively clear oracle
- `Hospital` requires mode/alarm oracle awareness
- `LRT` is a top difficulty candidate

## Protocol Bias
- `Stadium / Government / Business Center`: `BACnet`, `MQTT`, `Modbus`
- `Oil Depot`: `Modbus`, `OPC UA`, `EtherNet/IP`
- `Hospital`: `BACnet`, `Modbus`, `MQTT`
- `LRT`: `S7`, `IEC104`, `Modbus`, `OPC UA`

## Hard Rules
- Prioritize internal cred/path over direct SCADA web attacks
- Hackcity follows `low-noise`, `cred-first` approach
- No SCADA writes until `2 oracles` are confirmed
