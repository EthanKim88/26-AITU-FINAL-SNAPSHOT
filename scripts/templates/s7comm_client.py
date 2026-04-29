#!/usr/bin/env python3
"""S7comm (Siemens) template — PLC connection, CPU info, DB/Flag/Marker read/write."""
import argparse, json, re, struct, sys

class S7Probe:
    def __init__(self, host: str, port: int = 102, rack: int = 0, slot: int = 1):
        self.host = host
        self.port = port
        self.rack = rack
        self.slot = slot
        self.client = None

    def connect(self) -> bool:
        import snap7
        self.client = snap7.client.Client()
        try:
            self.client.connect(self.host, self.rack, self.slot, self.port)
            return self.client.get_connected()
        except Exception as e:
            print(f"Connection failed: {e}", file=sys.stderr)
            # Try rack/slot combinations
            for r in range(3):
                for s in range(4):
                    if r == self.rack and s == self.slot:
                        continue
                    try:
                        self.client.connect(self.host, r, s, self.port)
                        if self.client.get_connected():
                            print(f"Connected with rack={r} slot={s}")
                            self.rack, self.slot = r, s
                            return True
                    except Exception:
                        pass
            return False

    def close(self):
        if self.client:
            self.client.disconnect()

    def get_cpu_info(self) -> dict:
        """CPU model, serial number, module info."""
        try:
            info = self.client.get_cpu_info()
            return {
                "module_type": info.ModuleTypeName.decode().strip('\x00'),
                "serial": info.SerialNumber.decode().strip('\x00'),
                "as_name": info.ASName.decode().strip('\x00'),
                "module_name": info.ModuleName.decode().strip('\x00'),
            }
        except Exception as e:
            return {"error": str(e)}

    def get_cpu_state(self) -> str:
        """CPU state: Run, Stop, Unknown."""
        try:
            return self.client.get_cpu_state()
        except Exception as e:
            return f"error: {e}"

    def read_db(self, db_number: int, start: int, size: int) -> bytes | None:
        """Read Data Block."""
        try:
            return bytes(self.client.db_read(db_number, start, size))
        except Exception:
            return None

    def write_db(self, db_number: int, start: int, data: bytes) -> bool:
        """Write Data Block."""
        try:
            self.client.db_write(db_number, start, data)
            return True
        except Exception as e:
            print(f"Write DB{db_number} failed: {e}", file=sys.stderr)
            return False

    def read_area(self, area: str, start: int, size: int) -> bytes | None:
        """Read memory area. area: MK (Marker), I (Input), Q (Output), PE, PA, CT, TM."""
        import snap7
        area_map = {
            "MK": snap7.types.Areas.MK,
            "I": snap7.types.Areas.PE,
            "Q": snap7.types.Areas.PA,
            "CT": snap7.types.Areas.CT,
            "TM": snap7.types.Areas.TM,
        }
        a = area_map.get(area.upper())
        if a is None:
            return None
        try:
            return bytes(self.client.read_area(a, 0, start, size))
        except Exception:
            return None

    def scan_dbs(self, max_db: int = 100, read_size: int = 256) -> dict:
        """Scan accessible DB blocks + read contents."""
        result = {}
        for db in range(1, max_db + 1):
            data = self.read_db(db, 0, read_size)
            if data:
                result[db] = {
                    "size": len(data),
                    "hex": data.hex(),
                    "ascii": data.decode("ascii", errors="replace"),
                }
        return result

    def search_flags(self, patterns: list[str] | None = None) -> list[dict]:
        """Search for flags in DB blocks + Marker area."""
        if not patterns:
            patterns = [r"(?:flag|cremitflag|AITU|AITUCTF|CTF|aitu)\{[^}]+\}"]
        compiled = [re.compile(p) for p in patterns]
        found = []

        # DB blocks
        for db in range(1, 100):
            data = self.read_db(db, 0, 1024)
            if not data:
                continue
            text = data.decode("ascii", errors="replace")
            for pat in compiled:
                for m in pat.finditer(text):
                    found.append({"flag": m.group(0), "source": f"DB{db}", "offset": m.start()})

        # Marker area
        mk = self.read_area("MK", 0, 1024)
        if mk:
            text = mk.decode("ascii", errors="replace")
            for pat in compiled:
                for m in pat.finditer(text):
                    found.append({"flag": m.group(0), "source": "Markers", "offset": m.start()})

        return found

    def scan_all(self) -> dict:
        """Full scan: connect → CPU info → DB scan → flags."""
        result = {"host": self.host, "port": self.port, "rack": self.rack, "slot": self.slot}

        if not self.connect():
            result["error"] = "Connection failed (tried multiple rack/slot)"
            return result

        result["cpu_info"] = self.get_cpu_info()
        result["cpu_state"] = self.get_cpu_state()
        result["dbs"] = self.scan_dbs()
        result["flags"] = self.search_flags()

        self.close()
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="S7comm (Siemens) probe")
    parser.add_argument("--host", "-t", required=True)
    parser.add_argument("--port", "-p", type=int, default=102)
    parser.add_argument("--rack", type=int, default=0)
    parser.add_argument("--slot", type=int, default=1)
    parser.add_argument("--json", "-j", action="store_true")
    args = parser.parse_args()

    probe = S7Probe(args.host, args.port, args.rack, args.slot)
    result = probe.scan_all()

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"S7comm {args.host}:{args.port} rack={args.rack} slot={args.slot}")
        print(f"  CPU: {result.get('cpu_info', {})}")
        print(f"  State: {result.get('cpu_state')}")
        print(f"  DBs found: {len(result.get('dbs', {}))}")
        for db, data in result.get("dbs", {}).items():
            ascii_clean = data["ascii"][:80].replace("\x00", ".")
            print(f"    DB{db} ({data['size']}B): {ascii_clean}")
        for f in result.get("flags", []):
            print(f"  FLAG: {f['flag']} at {f['source']} offset {f['offset']}")
