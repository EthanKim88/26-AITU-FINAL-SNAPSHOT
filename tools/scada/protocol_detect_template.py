#!/usr/bin/env python3
"""Protocol hint detector for selecting SCADA coding templates."""

from __future__ import annotations

import argparse
import json
import socket
from typing import Dict, List


CANDIDATES: List[Dict[str, object]] = [
    {
        "name": "s7comm",
        "port": 102,
        "transport": "tcp",
        "template": "tools/scada/s7comm_template.py",
        "runtime": "scripts/templates/s7comm_client.py",
    },
    {
        "name": "modbus_tcp",
        "port": 502,
        "transport": "tcp",
        "template": "tools/scada/modbus_template.py",
        "runtime": "scripts/templates/modbus_tcp.py",
    },
    {
        "name": "mqtt",
        "port": 1883,
        "transport": "tcp",
        "template": "tools/scada/mqtt_template.py",
        "runtime": "scripts/templates/mqtt_client.py",
    },
    {
        "name": "iec104",
        "port": 2404,
        "transport": "tcp",
        "template": "tools/scada/iec104_template.py",
        "runtime": "scripts/templates/iec104_client.py",
    },
    {
        "name": "opcua",
        "port": 4840,
        "transport": "tcp",
        "template": "tools/scada/opcua_template.py",
        "runtime": "scripts/templates/opcua_client.py",
    },
    {
        "name": "dnp3",
        "port": 20000,
        "transport": "tcp",
        "template": "tools/scada/dnp3_template.py",
        "runtime": "scripts/templates/dnp3_client.py",
    },
    {
        "name": "enip",
        "port": 44818,
        "transport": "tcp",
        "template": "tools/scada/enip_template.py",
        "runtime": "scripts/templates/enip_client.py",
    },
    {
        "name": "bacnet",
        "port": 47808,
        "transport": "udp",
        "template": "tools/scada/bacnet_template.py",
        "runtime": "scripts/templates/bacnet_scan.py",
    },
]


def check_tcp(host: str, port: int, timeout: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def check_udp(host: str, port: int, timeout: float) -> bool:
    payload = b"\x81\x0b\x00\x0c\x01\x20\xff\xff\x00\xff\x10\x08"
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(timeout)
            sock.sendto(payload, (host, port))
            sock.recvfrom(1024)
            return True
    except socket.timeout:
        return False
    except Exception:
        return False


def detect(host: str, timeout: float) -> Dict[str, object]:
    findings = []
    for c in CANDIDATES:
        port = int(c["port"])
        transport = str(c["transport"])
        is_open = check_udp(host, port, timeout) if transport == "udp" else check_tcp(host, port, timeout)
        findings.append(
            {
                "protocol": c["name"],
                "transport": transport,
                "port": port,
                "reachable": is_open,
                "template": c["template"],
                "runtime_script": c["runtime"],
                "runtime_cmd": f"uv run {c['runtime']} -t {host} --json",
                "custom_code_cmd": (
                    "mkdir -p scripts/scada/custom && "
                    f"cp {c['template']} scripts/scada/custom/{c['name']}_{host.replace('.', '_')}.py"
                ),
            }
        )

    reachable = [f for f in findings if f["reachable"]]
    return {
        "host": host,
        "reachable_protocols": reachable,
        "all_candidates": findings,
        "next": "Use runtime_cmd for immediate enum, custom_code_cmd for template-based coding.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Detect likely ICS protocols and map to coding templates")
    parser.add_argument("-t", "--target", required=True, help="Target IP/hostname")
    parser.add_argument("--timeout", type=float, default=1.5, help="Socket timeout")
    parser.add_argument("--json", action="store_true", help="Emit JSON")
    args = parser.parse_args()

    result = detect(args.target, args.timeout)
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    print(f"[protocol-detect] target={args.target}")
    for item in result["all_candidates"]:
        status = "open" if item["reachable"] else "closed/unknown"
        print(f"- {item['protocol']} {item['transport']}/{item['port']}: {status}")
    print("\nReachable templates:")
    for item in result["reachable_protocols"]:
        print(f"- {item['protocol']}: {item['template']}")


if __name__ == "__main__":
    main()
