#!/usr/bin/env python3
"""Template scaffold for custom BACnet/IP risk scripts."""

from __future__ import annotations

from scada_template_base import ProtocolTemplateBase, base_parser, emit


class BacnetTemplate(ProtocolTemplateBase):
    protocol = "bacnet_ip"
    default_port = 47808
    transport = "udp"

    def build_probe_payload(self) -> bytes:
        # BVLC + NPDU + APDU who-is (placeholder)
        return bytes.fromhex("810b000c0120ffff00ff1008")

    def enumerate_assets(self) -> dict:
        # TODO: implement BACnet object/property reads (bacpypes3/BAC0).
        return {
            "todo": "Discover devices/objects and read writable properties.",
            "recommended_commands": [
                f"uv run scripts/templates/bacnet_scan.py -t {self.host} --json",
            ],
        }


def main() -> None:
    parser = base_parser("BACnet/IP template", default_port=47808)
    args = parser.parse_args()
    result = BacnetTemplate(args.target, args.port, args.timeout).scan_all()
    emit(result, args.json)


if __name__ == "__main__":
    main()
