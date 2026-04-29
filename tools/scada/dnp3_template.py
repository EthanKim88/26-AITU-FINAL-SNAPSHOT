#!/usr/bin/env python3
"""Template scaffold for custom DNP3 risk scripts."""

from __future__ import annotations

from scada_template_base import ProtocolTemplateBase, base_parser, emit


class Dnp3Template(ProtocolTemplateBase):
    protocol = "dnp3"
    default_port = 20000
    transport = "tcp"

    def build_probe_payload(self) -> bytes:
        # DNP3 start bytes + placeholder link header
        return bytes.fromhex("056405c401000004")

    def enumerate_assets(self) -> dict:
        # TODO: implement object group/class polling and control command checks.
        return {
            "todo": "Read binary/analog objects and map control points.",
            "recommended_commands": [
                f"uv run scripts/templates/dnp3_client.py -t {self.host} --json",
            ],
        }


def main() -> None:
    parser = base_parser("DNP3 template", default_port=20000)
    args = parser.parse_args()
    result = Dnp3Template(args.target, args.port, args.timeout).scan_all()
    emit(result, args.json)


if __name__ == "__main__":
    main()
