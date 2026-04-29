#!/usr/bin/env python3
"""Shared base classes for SCADA protocol templates."""

from __future__ import annotations

import argparse
import json
import socket
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List


@dataclass
class TemplateResult:
    protocol: str
    host: str
    port: int
    status: str = "unknown"
    duration_ms: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)
    findings: List[str] = field(default_factory=list)
    flags: List[str] = field(default_factory=list)
    evidence: List[Dict[str, Any]] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)


class ProtocolTemplateBase:
    """Minimal template base for protocol-specific coding."""

    protocol = "unknown"
    default_port = 0
    transport = "tcp"  # tcp | udp

    def __init__(self, host: str, port: int | None = None, timeout: float = 3.0) -> None:
        self.host = host
        self.port = port or self.default_port
        self.timeout = timeout
        self.result = TemplateResult(protocol=self.protocol, host=self.host, port=self.port)

    def add_evidence(self, title: str, data: Any) -> None:
        self.result.evidence.append({"title": title, "data": data})

    def build_probe_payload(self) -> bytes:
        return b""

    def tcp_probe(self, payload: bytes = b"") -> Dict[str, Any]:
        out: Dict[str, Any] = {"transport": "tcp", "connected": False}
        try:
            with socket.create_connection((self.host, self.port), timeout=self.timeout) as sock:
                sock.settimeout(self.timeout)
                out["connected"] = True
                if payload:
                    sock.sendall(payload)
                    try:
                        out["response_hex"] = sock.recv(512).hex()
                    except socket.timeout:
                        out["response_hex"] = ""
                else:
                    try:
                        out["banner"] = sock.recv(512).decode("utf-8", errors="replace")
                    except socket.timeout:
                        out["banner"] = ""
        except Exception as exc:  # pragma: no cover - template path
            out["error"] = str(exc)
        return out

    def udp_probe(self, payload: bytes = b"") -> Dict[str, Any]:
        out: Dict[str, Any] = {"transport": "udp", "sent": False}
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.settimeout(self.timeout)
                sock.sendto(payload, (self.host, self.port))
                out["sent"] = True
                try:
                    resp, _ = sock.recvfrom(1024)
                    out["response_hex"] = resp.hex()
                except socket.timeout:
                    out["response_hex"] = ""
        except Exception as exc:  # pragma: no cover - template path
            out["error"] = str(exc)
        return out

    def probe(self) -> Dict[str, Any]:
        payload = self.build_probe_payload()
        if self.transport == "udp":
            return self.udp_probe(payload)
        return self.tcp_probe(payload)

    def enumerate_assets(self) -> Dict[str, Any]:
        """TODO: implement protocol-specific reads/browse logic."""
        return {
            "todo": "Implement protocol-specific enumeration.",
            "hints": [
                "Collect tags/registers/nodes.",
                "Record command + output as evidence.",
                "Return parseable JSON-friendly data.",
            ],
        }

    def detect_flags(self, enum_data: Dict[str, Any]) -> List[str]:
        """TODO: add protocol-specific flag extraction heuristics."""
        _ = enum_data
        return []

    def scan_all(self) -> Dict[str, Any]:
        started = time.time()
        probe_data = self.probe()
        self.result.metadata["probe"] = probe_data

        if probe_data.get("connected") or probe_data.get("sent"):
            self.result.status = "reachable"
            enum_data = self.enumerate_assets()
            self.result.metadata["enumeration"] = enum_data
            self.result.flags = self.detect_flags(enum_data)
            self.result.findings.append("Template executed. Fill TODO blocks for full logic.")
        else:
            self.result.status = "unreachable"
            self.result.errors.append("Connection/probe failed.")

        self.result.duration_ms = int((time.time() - started) * 1000)
        return asdict(self.result)


def emit(result: Dict[str, Any], as_json: bool = False) -> None:
    if as_json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    print(f"[{result['protocol']}] {result['host']}:{result['port']}")
    print(f"status={result['status']} duration_ms={result['duration_ms']}")
    if result.get("findings"):
        print("findings:")
        for finding in result["findings"]:
            print(f"- {finding}")
    if result.get("errors"):
        print("errors:")
        for err in result["errors"]:
            print(f"- {err}")


def base_parser(description: str, default_port: int) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("-t", "--target", required=True, help="Target IP/hostname")
    parser.add_argument("-p", "--port", type=int, default=default_port, help="Target port")
    parser.add_argument("--timeout", type=float, default=3.0, help="Socket timeout")
    parser.add_argument("--json", action="store_true", help="Emit JSON result")
    return parser
