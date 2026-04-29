# SCADA Import Samples (Offline)

This directory contains sample JSON files for `/api/import` validation.

Important: The sample data is organized around operational impact scenarios (e.g., LRT service disruption, business center power cutoff) rather than CTF flag patterns.

## Included Formats

- `protocol-detect.json` (`protocol_detect.py` format)
- `template-modbus.json`
- `template-opcua.json`
- `template-s7comm.json`
- `template-mqtt.json`
- `template-enip.json`
- `template-dnp3.json`
- `template-iec104.json`
- `template-bacnet.json`

## Quick Start

After starting the web app:

```bash
cd web-app
npm run dev -- --port 10000
```

In another terminal:

```bash
cd web-app
bash samples/scada/import-all.sh
```

## Manual Import Example

```bash
curl -sS -X POST http://127.0.0.1:10000/api/import \
  -H 'Content-Type: application/json' \
  --data-binary @samples/scada/template-opcua.json
```

## Verification Checklist

If the following protocols appear in `/api/scada/summary`'s `stats.protocolCounts`, the import was successful.

- `modbus`
- `opcua`
- `s7comm`
- `mqtt`
- `enip`
- `dnp3`
- `iec104`
- `bacnet`
