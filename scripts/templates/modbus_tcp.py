#!/usr/bin/env python3
"""Modbus TCP template — connect, Unit ID scan, full register read/write, flag search."""
import argparse, json, struct, re, sys
from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ModbusIOException

class ModbusProbe:
    def __init__(self, host: str, port: int = 502, timeout: float = 3.0):
        self.host = host
        self.port = port
        self.client = ModbusTcpClient(host, port=port, timeout=timeout)

    def connect(self) -> bool:
        return self.client.connect()

    def close(self):
        self.client.close()

    # --- Unit ID scan ---
    def scan_unit_ids(self, start: int = 0, end: int = 247) -> list[int]:
        """Return list of responding Unit IDs."""
        active = []
        for uid in range(start, end + 1):
            try:
                rr = self.client.read_holding_registers(0, 1, slave=uid)
                if not rr.isError():
                    active.append(uid)
            except Exception:
                pass
        return active

    # --- Read all register types ---
    def read_range(self, reg_type: str, start: int, count: int, unit: int = 1) -> list | None:
        """reg_type: holding, input, coil, discrete."""
        fn = {
            "holding": self.client.read_holding_registers,
            "input": self.client.read_input_registers,
            "coil": self.client.read_coils,
            "discrete": self.client.read_discrete_inputs,
        }.get(reg_type)
        if not fn:
            return None
        try:
            rr = fn(start, count, slave=unit)
            if rr.isError():
                return None
            return rr.registers if hasattr(rr, "registers") else rr.bits[:count]
        except Exception:
            return None

    def dump_all(self, unit: int = 1, max_addr: int = 500, chunk: int = 100) -> dict:
        """Dump all register types."""
        result = {}
        for rtype in ("holding", "input", "coil", "discrete"):
            data = {}
            for start in range(0, max_addr, chunk):
                vals = self.read_range(rtype, start, chunk, unit)
                if vals:
                    for i, v in enumerate(vals):
                        if v != 0:
                            data[start + i] = v
            if data:
                result[rtype] = data
        return result

    # --- Write ---
    def write_register(self, addr: int, value: int, unit: int = 1) -> bool:
        try:
            rr = self.client.write_register(addr, value, slave=unit)
            return not rr.isError()
        except Exception:
            return False

    def write_coil(self, addr: int, value: bool, unit: int = 1) -> bool:
        try:
            rr = self.client.write_coil(addr, value, slave=unit)
            return not rr.isError()
        except Exception:
            return False

    # --- Flag search ---
    def search_flags(self, unit: int = 1, max_addr: int = 500,
                     patterns: list[str] | None = None) -> list[dict]:
        """Search for ASCII flag strings in holding/input registers."""
        if not patterns:
            patterns = [r"(?:flag|cremitflag|AITU|AITUCTF|CTF|aitu)\{[^}]+\}"]
        compiled = [re.compile(p) for p in patterns]
        found = []

        for rtype in ("holding", "input"):
            all_vals = []
            for start in range(0, max_addr, 100):
                vals = self.read_range(rtype, start, 100, unit)
                if vals:
                    all_vals.extend(vals)

            # 16-bit → ASCII (big-endian)
            text_be = ""
            for v in all_vals:
                hi, lo = (v >> 8) & 0xFF, v & 0xFF
                text_be += chr(hi) if 32 <= hi < 127 else "."
                text_be += chr(lo) if 32 <= lo < 127 else "."

            # 16-bit → ASCII (little-endian)
            text_le = ""
            for v in all_vals:
                lo, hi = v & 0xFF, (v >> 8) & 0xFF
                text_le += chr(lo) if 32 <= lo < 127 else "."
                text_le += chr(hi) if 32 <= hi < 127 else "."

            for text, endian in [(text_be, "BE"), (text_le, "LE")]:
                for pat in compiled:
                    for m in pat.finditer(text):
                        found.append({
                            "flag": m.group(0),
                            "register_type": rtype,
                            "endian": endian,
                            "char_offset": m.start(),
                        })
        return found

    # --- Float decode ---
    @staticmethod
    def regs_to_float(r1: int, r2: int) -> dict:
        """Convert 2 registers to float (3 byte orders)."""
        result = {}
        for label, pack in [
            ("BE", struct.pack(">HH", r1, r2)),
            ("LE", struct.pack("<HH", r1, r2)),
            ("WS", struct.pack(">HH", r2, r1)),
        ]:
            result[label] = struct.unpack(">f", pack)[0]
        return result

    # --- Full scan ---
    def scan_all(self, units: list[int] | None = None) -> dict:
        """Connect → Unit ID scan → register dump → flag search."""
        if not self.connect():
            return {"error": f"Cannot connect to {self.host}:{self.port}"}

        result = {"host": self.host, "port": self.port, "units": {}}

        if units is None:
            units = self.scan_unit_ids(0, 10)  # Quick scan (0-10)
            if not units:
                units = [1]  # Default

        for uid in units:
            dump = self.dump_all(uid)
            flags = self.search_flags(uid)
            result["units"][uid] = {"registers": dump, "flags": flags}

        self.close()
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Modbus TCP probe")
    parser.add_argument("--host", "-t", required=True)
    parser.add_argument("--port", "-p", type=int, default=502)
    parser.add_argument("--unit", "-u", type=int, default=None)
    parser.add_argument("--json", "-j", action="store_true", help="JSON output")
    args = parser.parse_args()

    probe = ModbusProbe(args.host, args.port)
    units = [args.unit] if args.unit is not None else None
    result = probe.scan_all(units)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for uid, data in result.get("units", {}).items():
            print(f"\n=== Unit {uid} ===")
            for rtype, regs in data.get("registers", {}).items():
                print(f"  {rtype}: {len(regs)} non-zero registers")
                for addr, val in sorted(regs.items(), key=lambda x: int(x[0])):
                    print(f"    [{addr:>5}] = {val} (0x{val:04X})" if isinstance(val, int) else f"    [{addr:>5}] = {val}")
            for f in data.get("flags", []):
                print(f"  FLAG: {f['flag']} ({f['register_type']}, {f['endian']})")
