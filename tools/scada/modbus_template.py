#!/usr/bin/env python3
"""Template scaffold for custom Modbus TCP risk scripts."""

from __future__ import annotations

from scada_template_base import ProtocolTemplateBase, base_parser, emit


class ModbusTemplate(ProtocolTemplateBase):
    protocol = "modbus_tcp"
    default_port = 502
    transport = "tcp"

    def build_probe_payload(self) -> bytes:
        # MBAP + PDU: transaction=1, unit=1, function=0x03, addr=0, qty=1
        return bytes.fromhex("000100000006010300000001")

    def enumerate_assets(self) -> dict:
        # TODO: replace with pymodbus reads suited for risk description.
        return {
            "todo": "Read holding/input/coils required by the risk.",
            "recommended_commands": [
                f"uv run scripts/scada/modbus_rw.py -t {self.host} read holding 0-200 --decode float32",
                f"uv run scripts/scada/modbus_rw.py -t {self.host} read holding 0-200 --decode ascii",
            ],
        }


def main() -> None:
    parser = base_parser("Modbus TCP template", default_port=502)
    args = parser.parse_args()
    result = ModbusTemplate(args.target, args.port, args.timeout).scan_all()
    emit(result, args.json)


if __name__ == "__main__":
    main()
