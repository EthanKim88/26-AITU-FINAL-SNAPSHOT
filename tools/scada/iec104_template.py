#!/usr/bin/env python3
"""Template scaffold for custom IEC-104 risk scripts."""

from __future__ import annotations

from scada_template_base import ProtocolTemplateBase, base_parser, emit


class Iec104Template(ProtocolTemplateBase):
    protocol = "iec104"
    default_port = 2404
    transport = "tcp"

    def build_probe_payload(self) -> bytes:
        # U-frame STARTDT act
        return bytes.fromhex("680407000000")

    def enumerate_assets(self) -> dict:
        # TODO: implement ASDU parsing and command sequences.
        return {
            "todo": "Parse ASDUs and identify controllable IOAs.",
            "recommended_commands": [
                f"uv run scripts/templates/iec104_client.py -t {self.host} --json",
            ],
        }


def main() -> None:
    parser = base_parser("IEC-104 template", default_port=2404)
    args = parser.parse_args()
    result = Iec104Template(args.target, args.port, args.timeout).scan_all()
    emit(result, args.json)


if __name__ == "__main__":
    main()
