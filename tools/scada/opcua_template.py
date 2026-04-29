#!/usr/bin/env python3
"""Template scaffold for custom OPC UA risk scripts."""

from __future__ import annotations

from scada_template_base import ProtocolTemplateBase, base_parser, emit


class OpcUaTemplate(ProtocolTemplateBase):
    protocol = "opcua"
    default_port = 4840
    transport = "tcp"

    def build_probe_payload(self) -> bytes:
        # OPC UA HEL preface placeholder
        return b"HELF\x00\x00\x00\x00"

    def enumerate_assets(self) -> dict:
        # TODO: implement asyncua browse/read/write flows for target namespace.
        return {
            "todo": "Browse namespace, read interesting nodes, test minimal write if required.",
            "recommended_commands": [
                f"uv run scripts/templates/opcua_client.py -t {self.host} --json",
                f"uv run scripts/templates/opcua_client.py -t {self.host} --read 'ns=2;i=2' --json",
            ],
        }


def main() -> None:
    parser = base_parser("OPC UA template", default_port=4840)
    args = parser.parse_args()
    result = OpcUaTemplate(args.target, args.port, args.timeout).scan_all()
    emit(result, args.json)


if __name__ == "__main__":
    main()
