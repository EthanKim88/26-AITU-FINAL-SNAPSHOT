#!/usr/bin/env python3
"""EtherNet/IP (CIP) template — Allen-Bradley PLC tag enumeration, read/write, flag search."""
import argparse, json, re, sys

class EnipProbe:
    def __init__(self, host: str, port: int = 44818):
        self.host = host
        self.port = port

    def list_tags(self) -> list[dict]:
        """Query PLC tag list (pycomm3)."""
        from pycomm3 import LogixDriver
        try:
            with LogixDriver(self.host) as plc:
                tags = plc.get_tag_list()
                return [
                    {
                        "name": t.tag_name if hasattr(t, 'tag_name') else str(t.get("tag_name", t)),
                        "type": str(t.data_type_name) if hasattr(t, 'data_type_name') else str(t.get("data_type", "")),
                        "dim": getattr(t, 'dimensions', None) or t.get("dimensions"),
                    }
                    for t in tags
                ]
        except Exception as e:
            return [{"error": str(e)}]

    def read_tag(self, tag_name: str):
        """Read a single tag."""
        from pycomm3 import LogixDriver
        try:
            with LogixDriver(self.host) as plc:
                result = plc.read(tag_name)
                return {"tag": tag_name, "value": result.value, "type": str(result.type)}
        except Exception as e:
            return {"tag": tag_name, "error": str(e)}

    def read_tags(self, tag_names: list[str]) -> list[dict]:
        """Read multiple tags."""
        from pycomm3 import LogixDriver
        try:
            with LogixDriver(self.host) as plc:
                results = plc.read(*tag_names)
                if not isinstance(results, list):
                    results = [results]
                return [
                    {"tag": r.tag, "value": r.value, "type": str(r.type)}
                    for r in results
                ]
        except Exception as e:
            return [{"error": str(e)}]

    def write_tag(self, tag_name: str, value) -> bool:
        """Write a single tag."""
        from pycomm3 import LogixDriver
        try:
            with LogixDriver(self.host) as plc:
                result = plc.write((tag_name, value))
                return result.value is not None
        except Exception as e:
            print(f"Write failed: {e}", file=sys.stderr)
            return False

    def identity(self) -> dict:
        """CIP Identity request (device info)."""
        from pycomm3 import LogixDriver
        try:
            with LogixDriver(self.host) as plc:
                return {
                    "name": plc.name,
                    "vendor": getattr(plc, 'vendor', 'unknown'),
                    "product_type": getattr(plc, 'product_type', 'unknown'),
                    "revision": getattr(plc, 'revision', 'unknown'),
                    "serial": getattr(plc, 'serial_number', 'unknown'),
                }
        except Exception as e:
            return {"error": str(e)}

    def search_flags(self, patterns: list[str] | None = None) -> list[dict]:
        """Search for flags across all tag values."""
        if not patterns:
            patterns = [r"(?:flag|cremitflag|AITU|AITUCTF|CTF|aitu)\{[^}]+\}"]
        compiled = [re.compile(p) for p in patterns]

        tags = self.list_tags()
        if not tags or "error" in tags[0]:
            return []

        # Read string tags only
        tag_names = [t["name"] for t in tags if "error" not in t]
        found = []

        from pycomm3 import LogixDriver
        try:
            with LogixDriver(self.host) as plc:
                for tname in tag_names:
                    try:
                        r = plc.read(tname)
                        val = str(r.value) if r.value is not None else ""
                        for pat in compiled:
                            for m in pat.finditer(val):
                                found.append({"flag": m.group(0), "tag": tname})
                            for m in pat.finditer(tname):
                                found.append({"flag": m.group(0), "tag": tname, "source": "tag_name"})
                    except Exception:
                        pass
        except Exception:
            pass

        return found

    def scan_all(self) -> dict:
        """Full scan: Identity → tag list → read values → flags."""
        result = {"host": self.host, "port": self.port}
        result["identity"] = self.identity()
        tags = self.list_tags()
        result["tags"] = tags
        result["tag_count"] = len(tags)

        # Read tag values (up to 100)
        tag_names = [t["name"] for t in tags if "error" not in t][:100]
        if tag_names:
            result["values"] = self.read_tags(tag_names)

        result["flags"] = self.search_flags()
        return result


# --- cpppo fallback (when pycomm3 fails) ---
def cpppo_read(host: str, tags: list[str]) -> list[dict]:
    """Read tags via cpppo (low-level EtherNet/IP)."""
    import subprocess
    results = []
    for tag in tags:
        try:
            out = subprocess.check_output(
                ["python3", "-m", "cpppo.server.enip.client",
                 "--address", host, "--print", tag],
                timeout=10, stderr=subprocess.DEVNULL,
            ).decode().strip()
            results.append({"tag": tag, "value": out})
        except Exception as e:
            results.append({"tag": tag, "error": str(e)})
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="EtherNet/IP (CIP) probe")
    parser.add_argument("--host", "-t", required=True)
    parser.add_argument("--port", "-p", type=int, default=44818)
    parser.add_argument("--json", "-j", action="store_true")
    parser.add_argument("--read", "-r", help="Read a tag by name")
    parser.add_argument("--write", "-w", nargs=2, metavar=("TAG", "VALUE"))
    args = parser.parse_args()

    probe = EnipProbe(args.host, args.port)

    if args.read:
        print(json.dumps(probe.read_tag(args.read), indent=2, default=str))
    elif args.write:
        ok = probe.write_tag(args.write[0], args.write[1])
        print("OK" if ok else "FAILED")
    else:
        result = probe.scan_all()
        if args.json:
            print(json.dumps(result, indent=2, default=str))
        else:
            print(f"EtherNet/IP {args.host}:{args.port}")
            print(f"  Identity: {result.get('identity', {})}")
            print(f"  Tags: {result.get('tag_count', 0)}")
            for t in result.get("tags", [])[:20]:
                if "error" not in t:
                    print(f"    {t['name']} ({t['type']})")
            for f in result.get("flags", []):
                print(f"  FLAG: {f['flag']} at tag {f['tag']}")
