#!/usr/bin/env python3
"""OPC UA template — anonymous access, node tree browsing, tag value read/write, flag search."""
import argparse, asyncio, json, re, sys

class OpcuaProbe:
    def __init__(self, host: str, port: int = 4840, security: str = "None"):
        self.url = f"opc.tcp://{host}:{port}"
        self.host = host
        self.port = port
        self.security = security
        self.client = None

    async def connect(self) -> bool:
        from asyncua import Client
        self.client = Client(self.url)
        if self.security != "None":
            # Configure authentication here if required
            pass
        try:
            await self.client.connect()
            return True
        except Exception as e:
            print(f"Connection failed: {e}", file=sys.stderr)
            return False

    async def close(self):
        if self.client:
            await self.client.disconnect()

    async def get_endpoints(self) -> list[dict]:
        """List server endpoints (for security mode inspection)."""
        from asyncua import Client
        try:
            endpoints = await Client(self.url).connect_and_get_server_endpoints()
            return [
                {
                    "url": str(ep.EndpointUrl),
                    "security_mode": str(ep.SecurityMode),
                    "security_policy": str(ep.SecurityPolicyUri),
                }
                for ep in endpoints
            ]
        except Exception as e:
            return [{"error": str(e)}]

    async def browse_tree(self, node=None, depth: int = 0, max_depth: int = 5) -> list[dict]:
        """Recursively browse node tree. Nodes with values also return their value."""
        if depth > max_depth:
            return []
        if node is None:
            node = self.client.get_objects_node()

        result = []
        try:
            children = await node.get_children()
        except Exception:
            return result

        for child in children:
            entry = {"depth": depth}
            try:
                name = await child.read_browse_name()
                entry["name"] = f"{name.NamespaceIndex}:{name.Name}"
                entry["node_id"] = str(child.nodeid)
            except Exception:
                continue

            try:
                val = await child.read_value()
                entry["value"] = str(val) if not isinstance(val, (int, float, bool, str)) else val
                entry["type"] = type(val).__name__
            except Exception:
                pass  # Folder nodes have no value

            result.append(entry)
            sub = await self.browse_tree(child, depth + 1, max_depth)
            result.extend(sub)

        return result

    async def read_node(self, node_id: str):
        """Read a single node value. node_id example: 'ns=2;i=1001' or 'ns=2;s=Temperature'."""
        from asyncua import ua
        node = self.client.get_node(node_id)
        return await node.read_value()

    async def write_node(self, node_id: str, value, type_hint: str = "auto") -> bool:
        """Write a single node value."""
        from asyncua import ua
        node = self.client.get_node(node_id)
        try:
            if type_hint == "auto":
                await node.write_value(value)
            else:
                # Explicit type specification
                vtype = getattr(ua.VariantType, type_hint, None)
                if vtype:
                    await node.write_value(ua.DataValue(ua.Variant(value, vtype)))
                else:
                    await node.write_value(value)
            return True
        except Exception as e:
            print(f"Write failed: {e}", file=sys.stderr)
            return False

    async def search_flags(self, patterns: list[str] | None = None) -> list[dict]:
        """Search for flag patterns in string values across the entire node tree."""
        if not patterns:
            patterns = [r"(?:flag|cremitflag|AITU|AITUCTF|CTF|aitu)\{[^}]+\}"]
        compiled = [re.compile(p) for p in patterns]

        tree = await self.browse_tree(max_depth=6)
        found = []
        for entry in tree:
            val = str(entry.get("value", ""))
            name = entry.get("name", "")
            for text in [val, name]:
                for pat in compiled:
                    for m in pat.finditer(text):
                        found.append({
                            "flag": m.group(0),
                            "node_id": entry.get("node_id"),
                            "node_name": name,
                            "source": "value" if text == val else "name",
                        })
        return found

    async def scan_all(self) -> dict:
        """Full scan: endpoints → connect → tree browse → flags."""
        result = {"host": self.host, "port": self.port}

        endpoints = await self.get_endpoints()
        result["endpoints"] = endpoints

        if not await self.connect():
            result["error"] = "Connection failed"
            return result

        tree = await self.browse_tree()
        result["nodes"] = tree
        result["node_count"] = len(tree)

        flags = await self.search_flags()
        result["flags"] = flags

        await self.close()
        return result


async def main():
    parser = argparse.ArgumentParser(description="OPC UA probe")
    parser.add_argument("--host", "-t", required=True)
    parser.add_argument("--port", "-p", type=int, default=4840)
    parser.add_argument("--json", "-j", action="store_true")
    parser.add_argument("--read", "-r", help="Read node by ID (e.g. ns=2;i=1001)")
    parser.add_argument("--write", "-w", nargs=2, metavar=("NODE_ID", "VALUE"), help="Write value to node")
    args = parser.parse_args()

    probe = OpcuaProbe(args.host, args.port)

    if args.read:
        if not await probe.connect():
            sys.exit(1)
        val = await probe.read_node(args.read)
        print(f"{args.read} = {val}")
        await probe.close()
    elif args.write:
        if not await probe.connect():
            sys.exit(1)
        ok = await probe.write_node(args.write[0], args.write[1])
        print("OK" if ok else "FAILED")
        await probe.close()
    else:
        result = await probe.scan_all()
        if args.json:
            print(json.dumps(result, indent=2, default=str))
        else:
            print(f"OPC UA {args.host}:{args.port}")
            print(f"  Endpoints: {len(result.get('endpoints', []))}")
            print(f"  Nodes: {result.get('node_count', 0)}")
            for n in result.get("nodes", []):
                indent = "  " * (n["depth"] + 1)
                val = f" = {n['value']}" if "value" in n else ""
                print(f"{indent}{n['name']}{val}")
            for f in result.get("flags", []):
                print(f"  FLAG: {f['flag']} at {f['node_id']}")


if __name__ == "__main__":
    asyncio.run(main())
