#!/usr/bin/env python3
"""BACnet/IP template — Who-Is discovery, Object enumeration, value read. scapy raw-based."""
import argparse, json, re, socket, struct, sys

# BACnet/IP uses UDP port 47808 (0xBAC0)
BACNET_PORT = 47808

class BacnetProbe:
    def __init__(self, host: str, port: int = BACNET_PORT, timeout: float = 3.0):
        self.host = host
        self.port = port
        self.timeout = timeout

    def _send_recv(self, data: bytes, broadcast: bool = False) -> list[tuple[bytes, str]]:
        """Send/receive UDP packets."""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(self.timeout)
        if broadcast:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        responses = []
        try:
            sock.sendto(data, (self.host, self.port))
            while True:
                try:
                    data, addr = sock.recvfrom(4096)
                    responses.append((data, addr[0]))
                except socket.timeout:
                    break
        finally:
            sock.close()
        return responses

    def who_is(self, low: int = 0, high: int = 4194303) -> list[dict]:
        """BACnet Who-Is broadcast → collect I-Am responses."""
        # BVLC header (10 bytes) + NPDU + APDU (Who-Is)
        bvlc = bytes([
            0x81,  # Type: BACnet/IP
            0x0B,  # Function: Original-Broadcast-NPDU
            0x00, 0x00,  # Length (fill later)
        ])
        npdu = bytes([
            0x01,  # Version
            0x20,  # Control: expect reply, no dest/src
        ])
        # Who-Is APDU (unconfirmed, service=8)
        apdu = bytes([0x10, 0x08])
        # Optional range
        if low > 0 or high < 4194303:
            apdu += bytes([0x09]) + struct.pack("!I", low)[-2:]  # context tag 0
            apdu += bytes([0x19]) + struct.pack("!I", high)[-2:]  # context tag 1

        pkt = bvlc + npdu + apdu
        # Fix length
        pkt = pkt[:2] + struct.pack("!H", len(pkt)) + pkt[4:]

        responses = self._send_recv(pkt, broadcast=True)
        devices = []
        for data, addr in responses:
            devices.append({
                "ip": addr,
                "raw_hex": data.hex(),
                "size": len(data),
            })
            # Basic I-Am parsing
            try:
                if len(data) > 12 and data[7] == 0x10 and data[8] == 0x00:
                    # Simple device instance extraction
                    devices[-1]["note"] = "I-Am response detected"
            except Exception:
                pass
        return devices

    def read_property(self, object_type: int, instance: int, property_id: int) -> bytes | None:
        """BACnet ReadProperty (confirmed request)."""
        bvlc = bytes([0x81, 0x0A, 0x00, 0x00])  # Original-Unicast
        npdu = bytes([0x01, 0x04])  # Version, expect reply
        # Confirmed request, service=12 (ReadProperty)
        apdu = bytes([
            0x00,  # Confirmed request
            0x04,  # Max segments, max APDU
            0x01,  # Invoke ID
            0x0C,  # Service: ReadProperty
        ])
        # Object identifier (context tag 0)
        obj_id = (object_type << 22) | instance
        apdu += bytes([0x0C]) + struct.pack("!I", obj_id)
        # Property identifier (context tag 1)
        apdu += bytes([0x19, property_id & 0xFF])

        pkt = bvlc + npdu + apdu
        pkt = pkt[:2] + struct.pack("!H", len(pkt)) + pkt[4:]

        responses = self._send_recv(pkt)
        if responses:
            return responses[0][0]
        return None

    def scan_objects(self, max_instance: int = 50) -> list[dict]:
        """Scan instances of major Object types."""
        # Major BACnet object types
        types = {
            0: "analog-input", 1: "analog-output", 2: "analog-value",
            3: "binary-input", 4: "binary-output", 5: "binary-value",
            8: "device", 13: "multi-state-input", 14: "multi-state-output",
            19: "multi-state-value",
        }
        found = []
        for otype, tname in types.items():
            for inst in range(max_instance):
                resp = self.read_property(otype, inst, 77)  # 77 = object-name
                if resp and len(resp) > 15:
                    # Extract ASCII from response
                    try:
                        text = resp[15:].decode("ascii", errors="replace").strip("\x00")
                        found.append({
                            "type": tname,
                            "instance": inst,
                            "name": text,
                            "raw": resp.hex(),
                        })
                    except Exception:
                        found.append({"type": tname, "instance": inst, "raw": resp.hex()})
        return found

    def search_flags(self, patterns: list[str] | None = None) -> list[dict]:
        if not patterns:
            patterns = [r"(?:flag|cremitflag|AITU|AITUCTF|CTF|aitu)\{[^}]+\}"]
        compiled = [re.compile(p) for p in patterns]
        found = []
        objects = self.scan_objects()
        for obj in objects:
            for text in [obj.get("name", ""), obj.get("raw", "")]:
                # Try hex decode too
                try:
                    text_from_hex = bytes.fromhex(obj.get("raw", "")).decode("ascii", errors="replace")
                    texts = [text, text_from_hex]
                except Exception:
                    texts = [text]
                for t in texts:
                    for pat in compiled:
                        for m in pat.finditer(t):
                            found.append({"flag": m.group(0), "object": f"{obj['type']}:{obj['instance']}"})
        return found

    def scan_all(self) -> dict:
        result = {"host": self.host, "port": self.port}
        result["who_is"] = self.who_is()
        result["objects"] = self.scan_objects()
        result["flags"] = self.search_flags()
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BACnet/IP probe")
    parser.add_argument("--host", "-t", required=True, help="Target IP or broadcast address")
    parser.add_argument("--port", "-p", type=int, default=BACNET_PORT)
    parser.add_argument("--json", "-j", action="store_true")
    parser.add_argument("--whois-only", action="store_true")
    args = parser.parse_args()

    probe = BacnetProbe(args.host, args.port)

    if args.whois_only:
        devs = probe.who_is()
        print(json.dumps(devs, indent=2))
    else:
        result = probe.scan_all()
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"BACnet {args.host}:{args.port}")
            print(f"  Devices (Who-Is): {len(result.get('who_is', []))}")
            for d in result.get("who_is", []):
                print(f"    {d['ip']} ({d['size']}B)")
            print(f"  Objects: {len(result.get('objects', []))}")
            for o in result.get("objects", []):
                print(f"    {o['type']}:{o['instance']} - {o.get('name', '?')}")
            for f in result.get("flags", []):
                print(f"  FLAG: {f['flag']} at {f['object']}")
