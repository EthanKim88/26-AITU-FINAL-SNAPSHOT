# SCADA Protocol Coding Templates

This directory contains protocol-oriented Python templates for quickly creating custom
SCADA/ICS analyzers and exploit PoCs during a CTF.

These templates are **code-authoring scaffolds**. They are separate from runtime-ready
scripts under `scripts/templates/`.

## Files
- `scada_template_base.py`: shared result model and probe helpers.
- `protocol_detect_template.py`: quick port/protocol hint scanner + template mapping.
- `modbus_template.py`
- `opcua_template.py`
- `s7comm_template.py`
- `mqtt_template.py`
- `enip_template.py`
- `bacnet_template.py`
- `dnp3_template.py`
- `iec104_template.py`
- `unknown_protocol_template.py`

## Quick start

1) Copy the protocol template and rename it for the current risk:

```bash
mkdir -p scripts/scada/custom
cp tools/scada/modbus_template.py scripts/scada/custom/risk_lrt_modbus.py
```

2) Fill the `TODO` blocks in the copied file.

3) Run:

```bash
uv run scripts/scada/custom/risk_lrt_modbus.py -t 10.10.13.101 --json
```

## Notes
- Use `scripts/templates/*.py` for default automated enumeration.
- Use `tools/scada/*.py` to bootstrap custom logic fast.
