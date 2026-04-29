#!/usr/bin/env python3
"""DNP3 template — TCP connection, data request, response parsing. scapy raw-based."""
import argparse, json, re, socket, struct, sys

DNP3_PORT = 20000

class Dnp3Probe:
    def __init__(self, host: str, port: int = DNP3_PORT, timeout: float = 5.0):
        self.host = host
        self.port = port
        self.timeout = timeout

    def _build_frame(self, dst: int, src: int, fc: int, payload: bytes = b"") -> bytes:
        """Build DNP3 data link frame."""
        # Data Link Header
        start = 0x0564
        length = 5 + len(payload)  # 5 = min header after length byte
        ctrl = 0xC0 | fc  # DIR=1, PRM=1, FC
        header = struct.pack("<HBB", start, length, ctrl)
        header += struct.pack("<HH", dst, src)
        # CRC (simplified — real DNP3 uses CRC per block)
        crc = self._crc16(header[2:])
        frame = header + struct.pack("<H", crc)
        if payload:
            # Data block + CRC
            frame += payload + struct.pack("<H", self._crc16(payload))
        return frame

    @staticmethod
    def _crc16(data: bytes) -> int:
        """DNP3 CRC-16."""
        crc = 0x0000
        poly = 0xA6BC
        for byte in data:
            crc ^= byte
            for _ in range(8):
                if crc & 0x0001:
                    crc = (crc >> 1) ^ poly
                else:
                    crc >>= 1
        return crc ^ 0xFFFF

    def _send_recv(self, data: bytes) -> bytes | None:
        """TCP send/receive."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(self.timeout)
            sock.connect((self.host, self.port))
            sock.send(data)
            resp = sock.recv(4096)
            sock.close()
            return resp
        except Exception as e:
            return None

    def link_status(self, dst: int = 1, src: int = 10) -> dict:
        """Link Status Request (FC=9)."""
        frame = self._build_frame(dst, src, 9)
        resp = self._send_recv(frame)
        if resp:
            return {"status": "responded", "raw": resp.hex(), "size": len(resp)}
        return {"status": "no_response"}

    def read_class0(self, dst: int = 1, src: int = 10) -> dict:
        """Class 0 data request (static data — current state)."""
        # Application layer: Read request, Class 0
        app_ctrl = 0xC0  # FIR=1, FIN=1, SEQ=0
        app_fc = 0x01  # READ
        # Object header: Group 60, Var 1 (Class 0), QC=0x06 (all)
        obj = bytes([0x3C, 0x01, 0x06])
        payload = bytes([app_ctrl, app_fc]) + obj

        frame = self._build_frame(dst, src, 4, payload)  # FC=4 = User Data
        resp = self._send_recv(frame)
        if resp:
            return {
                "status": "responded",
                "raw": resp.hex(),
                "ascii": resp.decode("ascii", errors="replace"),
                "size": len(resp),
            }
        return {"status": "no_response"}

    def read_class123(self, dst: int = 1, src: int = 10) -> dict:
        """Class 1+2+3 data request (event data)."""
        app_ctrl = 0xC1
        app_fc = 0x01
        obj = bytes([
            0x3C, 0x02, 0x06,  # Class 1
            0x3C, 0x03, 0x06,  # Class 2
            0x3C, 0x04, 0x06,  # Class 3
        ])
        payload = bytes([app_ctrl, app_fc]) + obj
        frame = self._build_frame(dst, src, 4, payload)
        resp = self._send_recv(frame)
        if resp:
            return {"status": "responded", "raw": resp.hex(), "size": len(resp)}
        return {"status": "no_response"}

    def scan_addresses(self, max_dst: int = 10, src: int = 10) -> list[int]:
        """Scan for responding DNP3 outstation addresses."""
        active = []
        for dst in range(max_dst + 1):
            result = self.link_status(dst, src)
            if result["status"] == "responded":
                active.append(dst)
        return active

    def search_flags(self, patterns: list[str] | None = None) -> list[dict]:
        if not patterns:
            patterns = [r"(?:flag|cremitflag|AITU|AITUCTF|CTF|aitu)\{[^}]+\}"]
        compiled = [re.compile(p) for p in patterns]
        found = []

        for dst in range(5):
            for reader in [self.read_class0, self.read_class123]:
                result = reader(dst)
                if result.get("status") != "responded":
                    continue
                for text in [result.get("ascii", ""), result.get("raw", "")]:
                    try:
                        hex_text = bytes.fromhex(result.get("raw", "")).decode("ascii", errors="replace")
                        texts = [text, hex_text]
                    except Exception:
                        texts = [text]
                    for t in texts:
                        for pat in compiled:
                            for m in pat.finditer(t):
                                found.append({"flag": m.group(0), "dst": dst, "source": reader.__name__})
        return found

    def scan_all(self) -> dict:
        result = {"host": self.host, "port": self.port}
        active = self.scan_addresses()
        result["active_addresses"] = active

        if active:
            dst = active[0]
            result["class0"] = self.read_class0(dst)
            result["class123"] = self.read_class123(dst)

        result["flags"] = self.search_flags()
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DNP3 probe")
    parser.add_argument("--host", "-t", required=True)
    parser.add_argument("--port", "-p", type=int, default=DNP3_PORT)
    parser.add_argument("--json", "-j", action="store_true")
    args = parser.parse_args()

    probe = Dnp3Probe(args.host, args.port)
    result = probe.scan_all()

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"DNP3 {args.host}:{args.port}")
        print(f"  Active addresses: {result.get('active_addresses', [])}")
        c0 = result.get("class0", {})
        if c0.get("status") == "responded":
            print(f"  Class 0: {c0['size']}B")
        for f in result.get("flags", []):
            print(f"  FLAG: {f['flag']} (dst={f['dst']})")
