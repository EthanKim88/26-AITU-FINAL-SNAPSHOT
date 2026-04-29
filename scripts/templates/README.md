# ICS/SCADA Protocol Templates

Basic connect → read → write code for each protocol.
AI agents adapt these templates to match the target protocol.

## File List

| File | Protocol | Default Port | Library |
|------|----------|-----------|-----------|
| `modbus_tcp.py` | Modbus TCP | 502 | pymodbus |
| `opcua_client.py` | OPC UA | 4840 | asyncua |
| `s7comm_client.py` | S7comm (Siemens) | 102 | python-snap7 |
| `mqtt_client.py` | MQTT | 1883/8883 | paho-mqtt |
| `enip_client.py` | EtherNet/IP (CIP) | 44818 | pycomm3 / cpppo |
| `bacnet_scan.py` | BACnet/IP | 47808 | scapy (raw) |
| `dnp3_client.py` | DNP3 | 20000 | scapy (raw) |
| `iec104_client.py` | IEC 60870-5-104 | 2404 | scapy (raw) |
| `protocol_detect.py` | Auto-detection | - | Multi |

## Usage

```bash
# Run directly (standalone test)
uv run scripts/templates/modbus_tcp.py --host 10.1.4.10

# Import from AI agent
from scripts.templates.modbus_tcp import ModbusProbe
probe = ModbusProbe("10.1.4.10")
probe.scan_all()
```
