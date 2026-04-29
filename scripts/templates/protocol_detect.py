#!/usr/bin/env python3
"""ICS protocol auto-detection — port-based + probe-based. First entry point for AI agents."""
import argparse, json, socket, struct, sys

# Port → protocol mapping
PORT_MAP = {
    102:   ("s7comm", "Siemens S7", "s7comm_client.py"),
    502:   ("modbus", "Modbus TCP", "modbus_tcp.py"),
    1883:  ("mqtt", "MQTT", "mqtt_client.py"),
    2404:  ("iec104", "IEC 60870-5-104", "iec104_client.py"),
    4840:  ("opcua", "OPC UA", "opcua_client.py"),
    4843:  ("opcua-tls", "OPC UA (TLS)", "opcua_client.py"),
    8883:  ("mqtt-tls", "MQTT (TLS)", "mqtt_client.py"),
    20000: ("dnp3", "DNP3", "dnp3_client.py"),
    44818: ("enip", "EtherNet/IP (CIP)", "enip_client.py"),
    47808: ("bacnet", "BACnet/IP", "bacnet_scan.py"),
    # Web-based HMI
    80:    ("http", "HTTP (HMI?)", None),
    443:   ("https", "HTTPS (HMI?)", None),
    8080:  ("http-alt", "HTTP-Alt (HMI?)", None),
    # DB (Historian)
    1433:  ("mssql", "MSSQL (Historian?)", None),
    3306:  ("mysql", "MySQL (Historian?)", None),
    5432:  ("postgresql", "PostgreSQL (Historian?)", None),
}

def probe_port(host: str, port: int, timeout: float = 3.0) -> dict:
    """Connect to port and identify protocol via banner/response."""
    result = {"port": port, "open": False}

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, port))
        result["open"] = True
    except Exception:
        return result

    # Check port mapping
    if port in PORT_MAP:
        proto, desc, template = PORT_MAP[port]
        result["protocol"] = proto
        result["description"] = desc
        result["template"] = template

    # Banner grabbing
    try:
        sock.settimeout(2)
        # Send empty request and receive banner (some services send banner on connect)
        banner = sock.recv(1024)
        if banner:
            result["banner_hex"] = banner.hex()
            result["banner_ascii"] = banner.decode("ascii", errors="replace")[:200]
            # Additional protocol identification
            result.update(_identify_by_banner(banner, port))
    except socket.timeout:
        pass

    # Modbus probe
    if port == 502 or result.get("protocol") == "modbus":
        try:
            # Modbus TCP: Transaction ID + Protocol ID + Length + Unit ID + FC03 + Start + Count
            modbus_req = struct.pack(">HHHBBHH", 0x0001, 0x0000, 0x0006, 1, 3, 0, 1)
            sock.send(modbus_req)
            sock.settimeout(2)
            resp = sock.recv(256)
            if resp and len(resp) >= 9:
                proto_id = struct.unpack(">H", resp[2:4])[0]
                if proto_id == 0:
                    result["protocol"] = "modbus"
                    result["modbus_confirmed"] = True
        except Exception:
            pass

    sock.close()
    return result


def _identify_by_banner(banner: bytes, port: int) -> dict:
    """Identify protocol by banner bytes."""
    extra = {}

    # S7comm: TPKT header (03 00)
    if banner[:2] == b"\x03\x00":
        extra["protocol"] = "s7comm"
        extra["description"] = "Siemens S7 (TPKT detected)"
        extra["template"] = "s7comm_client.py"

    # Modbus: Protocol ID = 0x0000
    elif len(banner) >= 6 and struct.unpack(">H", banner[2:4])[0] == 0:
        extra["protocol"] = "modbus"
        extra["modbus_confirmed"] = True

    # DNP3: Start bytes 0x05 0x64
    elif banner[:2] == b"\x05\x64":
        extra["protocol"] = "dnp3"
        extra["description"] = "DNP3 (start bytes detected)"
        extra["template"] = "dnp3_client.py"

    # IEC 104: Start byte 0x68
    elif banner[:1] == b"\x68" and len(banner) >= 6:
        extra["protocol"] = "iec104"
        extra["description"] = "IEC 104 (APCI detected)"
        extra["template"] = "iec104_client.py"

    # HTTP
    elif banner[:4] in (b"HTTP", b"<!DO", b"<htm", b"<HTM", b"{\n", b'{"'):
        extra["protocol"] = "http"
        extra["description"] = "HTTP/Web service"

    # MQTT: CONNACK (0x20)
    elif banner[:1] == b"\x20":
        extra["protocol"] = "mqtt"
        extra["template"] = "mqtt_client.py"

    return extra


def scan_host(host: str, ports: list[int] | None = None, timeout: float = 3.0) -> dict:
    """Scan all ICS ports on a host."""
    if ports is None:
        ports = sorted(PORT_MAP.keys())

    result = {"host": host, "services": []}
    for port in ports:
        probe = probe_port(host, port, timeout)
        if probe["open"]:
            result["services"].append(probe)

    return result


def suggest_next_steps(scan_result: dict) -> list[str]:
    """Suggest next template commands based on scan results."""
    host = scan_result["host"]
    steps = []
    for svc in scan_result.get("services", []):
        tmpl = svc.get("template")
        if tmpl:
            steps.append(f"uv run scripts/templates/{tmpl} --host {host} --port {svc['port']} --json")
        elif svc.get("protocol") in ("http", "https", "http-alt"):
            port = svc["port"]
            scheme = "https" if port == 443 else "http"
            steps.append(f"curl -sI {scheme}://{host}:{port}/")
        elif svc.get("protocol") in ("mssql", "mysql", "postgresql"):
            steps.append(f"# DB detected on port {svc['port']} — try default creds")
    return steps


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ICS protocol auto-detect")
    parser.add_argument("--host", "-t", required=True)
    parser.add_argument("--ports", nargs="+", type=int, help="Custom port list")
    parser.add_argument("--all-ports", action="store_true", help="Scan all ICS+common ports")
    parser.add_argument("--json", "-j", action="store_true")
    args = parser.parse_args()

    ports = args.ports if args.ports else None
    if args.all_ports:
        ports = sorted(set(list(PORT_MAP.keys()) + [21, 22, 23, 25, 53, 110, 161, 179, 993, 995,
                                                     2222, 3389, 5900, 5985, 6379, 8443, 9090, 9100]))

    result = scan_host(args.host, ports)
    steps = suggest_next_steps(result)

    if args.json:
        result["next_steps"] = steps
        print(json.dumps(result, indent=2))
    else:
        print(f"\nICS Protocol Scan: {args.host}")
        print("=" * 50)
        for svc in result.get("services", []):
            proto = svc.get("protocol", "unknown")
            desc = svc.get("description", "")
            confirmed = " [CONFIRMED]" if svc.get("modbus_confirmed") else ""
            print(f"  :{svc['port']}  {proto}{confirmed}  {desc}")
            if svc.get("banner_ascii"):
                print(f"         banner: {svc['banner_ascii'][:60]}")
        if not result.get("services"):
            print("  No ICS services found.")
        if steps:
            print(f"\nSuggested next steps:")
            for s in steps:
                print(f"  $ {s}")
