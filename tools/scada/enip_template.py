#!/usr/bin/env python3
"""Template scaffold for custom EtherNet/IP (CIP) risk scripts."""

from __future__ import annotations

from scada_template_base import ProtocolTemplateBase, base_parser, emit


class EnipTemplate(ProtocolTemplateBase):
    protocol = "ethernet_ip"
    default_port = 44818
    transport = "tcp"

    def build_probe_payload(self) -> bytes:
        # RegisterSession command (encapsulation header)
        return bytes.fromhex("6500040000000000000000000000000001000000")

    def enumerate_assets(self) -> dict:
        # TODO: implement pycomm3/cpppo reads for tags/classes.
        return {
            "todo": "Enumerate identity object and read target tags.",
            "recommended_commands": [
                f"uv run scripts/templates/enip_client.py -t {self.host} --json",
            ],
        }


def main() -> None:
    parser = base_parser("EtherNet/IP template", default_port=44818)
    args = parser.parse_args()
    result = EnipTemplate(args.target, args.port, args.timeout).scan_all()
    emit(result, args.json)


if __name__ == "__main__":
    main()
