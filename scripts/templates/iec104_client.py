#!/usr/bin/env python3
"""IEC 60870-5-104 template — STARTDT, Interrogation Command, response parsing."""
import argparse, json, re, socket, struct, sys, time

IEC104_PORT = 2404

class Iec104Probe:
    def __init__(self, host: str, port: int = IEC104_PORT, timeout: float = 5.0):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.sock = None
        self.tx_seq = 0
        self.rx_seq = 0

    def connect(self) -> bool:
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(self.timeout)
            self.sock.connect((self.host, self.port))
            return True
        except Exception as e:
            print(f"Connection failed: {e}", file=sys.stderr)
            return False

    def close(self):
        if self.sock:
            self.sock.close()

    def _send(self, data: bytes):
        self.sock.send(data)

    def _recv(self, size: int = 4096) -> bytes:
        try:
            return self.sock.recv(size)
        except socket.timeout:
            return b""

    @staticmethod
    def _build_apci(apdu_type: str, payload: bytes = b"") -> bytes:
        """Build APCI frame."""
        start = 0x68
        if apdu_type == "STARTDT_ACT":
            return bytes([start, 0x04, 0x07, 0x00, 0x00, 0x00])
        elif apdu_type == "STARTDT_CON":
            return bytes([start, 0x04, 0x0B, 0x00, 0x00, 0x00])
        elif apdu_type == "TESTFR_ACT":
            return bytes([start, 0x04, 0x43, 0x00, 0x00, 0x00])
        elif apdu_type == "I":
            # I-frame with payload
            length = 4 + len(payload)
            return bytes([start, length]) + payload
        return b""

    def startdt(self) -> bool:
        """STARTDT Activation → STARTDT Confirmation."""
        self._send(self._build_apci("STARTDT_ACT"))
        resp = self._recv()
        if resp and len(resp) >= 6:
            # Check for STARTDT_CON (byte[2] & 0x03 == 0x03 and byte[2] & 0x08)
            return True
        return False

    def interrogation(self, coa: int = 1) -> list[bytes]:
        """General Interrogation Command (TypeID=100)."""
        # I-frame: TypeID=100 (C_IC_NA_1), SQ=0, NumObj=1
        # COT=6 (activation), COA=coa, IOA=0
        tx_bytes = struct.pack("<H", self.tx_seq << 1)
        rx_bytes = struct.pack("<H", self.rx_seq << 1)
        asdu = bytes([
            100,  # TypeID: C_IC_NA_1
            0x01,  # SQ=0, NumObj=1
            0x06, 0x00,  # COT=6 (activation)
        ]) + struct.pack("<H", coa) + bytes([
            0x00, 0x00, 0x00,  # IOA = 0
            0x14,  # QOI = 20 (station interrogation)
        ])
        payload = tx_bytes + rx_bytes + asdu
        frame = self._build_apci("I", payload)
        self.tx_seq += 1

        self._send(frame)

        # Collect responses
        responses = []
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            resp = self._recv()
            if resp:
                responses.append(resp)
            else:
                break
        return responses

    def parse_responses(self, responses: list[bytes]) -> list[dict]:
        """Parse IEC 104 responses to extract data points."""
        points = []
        for resp in responses:
            offset = 0
            while offset < len(resp):
                if resp[offset] != 0x68:
                    offset += 1
                    continue
                if offset + 1 >= len(resp):
                    break
                apdu_len = resp[offset + 1]
                apdu = resp[offset + 2: offset + 2 + apdu_len]
                offset += 2 + apdu_len

                if len(apdu) < 10:
                    continue
                # Skip control field (4 bytes)
                asdu = apdu[4:]
                type_id = asdu[0]
                sq_num = asdu[1]
                num_obj = sq_num & 0x7F
                cot = asdu[2] & 0x3F

                point = {
                    "type_id": type_id,
                    "num_objects": num_obj,
                    "cot": cot,
                    "raw": asdu.hex(),
                    "ascii": asdu.decode("ascii", errors="replace"),
                }
                points.append(point)
        return points

    def search_flags(self, responses: list[bytes], patterns: list[str] | None = None) -> list[dict]:
        if not patterns:
            patterns = [r"(?:flag|cremitflag|AITU|AITUCTF|CTF|aitu)\{[^}]+\}"]
        compiled = [re.compile(p) for p in patterns]
        found = []

        all_data = b"".join(responses)
        text = all_data.decode("ascii", errors="replace")
        for pat in compiled:
            for m in pat.finditer(text):
                found.append({"flag": m.group(0), "source": "interrogation_response"})
        return found

    def scan_all(self) -> dict:
        result = {"host": self.host, "port": self.port}

        if not self.connect():
            result["error"] = "Connection failed"
            return result

        result["startdt"] = self.startdt()
        if not result["startdt"]:
            result["error"] = "STARTDT failed"
            self.close()
            return result

        responses = self.interrogation()
        result["response_count"] = len(responses)
        result["total_bytes"] = sum(len(r) for r in responses)
        result["data_points"] = self.parse_responses(responses)
        result["flags"] = self.search_flags(responses)

        self.close()
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="IEC 60870-5-104 probe")
    parser.add_argument("--host", "-t", required=True)
    parser.add_argument("--port", "-p", type=int, default=IEC104_PORT)
    parser.add_argument("--json", "-j", action="store_true")
    args = parser.parse_args()

    probe = Iec104Probe(args.host, args.port)
    result = probe.scan_all()

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"IEC 104 {args.host}:{args.port}")
        print(f"  STARTDT: {'OK' if result.get('startdt') else 'FAILED'}")
        print(f"  Responses: {result.get('response_count', 0)} ({result.get('total_bytes', 0)}B)")
        for dp in result.get("data_points", [])[:20]:
            print(f"    TypeID={dp['type_id']} COT={dp['cot']} objs={dp['num_objects']}")
        for f in result.get("flags", []):
            print(f"  FLAG: {f['flag']}")
