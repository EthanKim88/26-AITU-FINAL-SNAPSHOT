#!/usr/bin/env python3
"""MQTT template — anonymous connection, topic subscribe/enumerate, message collection, flag search."""
import argparse, json, re, sys, time, threading
from collections import defaultdict

class MqttProbe:
    def __init__(self, host: str, port: int = 1883, timeout: float = 10.0):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.client = None
        self.messages: list[dict] = []
        self.topics: set[str] = set()
        self._lock = threading.Lock()

    def connect(self, username: str = "", password: str = "") -> bool:
        import paho.mqtt.client as mqtt
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        if username:
            self.client.username_pw_set(username, password)
        self.client.on_message = self._on_message
        self.client.on_connect = self._on_connect
        try:
            self.client.connect(self.host, self.port, keepalive=60)
            self.client.loop_start()
            time.sleep(1)  # Wait for connection
            return True
        except Exception as e:
            print(f"Connection failed: {e}", file=sys.stderr)
            return False

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        # Subscribe with wildcards to collect all topics
        client.subscribe("#", qos=0)
        client.subscribe("$SYS/#", qos=0)  # Broker metadata

    def _on_message(self, client, userdata, msg):
        with self._lock:
            self.topics.add(msg.topic)
            payload = msg.payload.decode("utf-8", errors="replace")
            self.messages.append({
                "topic": msg.topic,
                "payload": payload,
                "qos": msg.qos,
                "retain": msg.retain,
            })

    def collect(self, duration: float = None) -> list[dict]:
        """Collect messages for a specified duration."""
        if duration is None:
            duration = self.timeout
        time.sleep(duration)
        with self._lock:
            return list(self.messages)

    def publish(self, topic: str, payload: str, qos: int = 0) -> bool:
        """Publish a message to a topic."""
        try:
            info = self.client.publish(topic, payload, qos=qos)
            info.wait_for_publish(timeout=5)
            return info.is_published()
        except Exception as e:
            print(f"Publish failed: {e}", file=sys.stderr)
            return False

    def search_flags(self, patterns: list[str] | None = None) -> list[dict]:
        """Search for flags in collected messages."""
        if not patterns:
            patterns = [r"(?:flag|cremitflag|AITU|AITUCTF|CTF|aitu)\{[^}]+\}"]
        compiled = [re.compile(p) for p in patterns]
        found = []
        with self._lock:
            for msg in self.messages:
                for text in [msg["payload"], msg["topic"]]:
                    for pat in compiled:
                        for m in pat.finditer(text):
                            found.append({
                                "flag": m.group(0),
                                "topic": msg["topic"],
                                "source": "payload" if text == msg["payload"] else "topic",
                            })
        return found

    def close(self):
        if self.client:
            self.client.loop_stop()
            self.client.disconnect()

    def scan_all(self) -> dict:
        """Full scan: connect → subscribe → collect → flags."""
        result = {"host": self.host, "port": self.port}

        if not self.connect():
            result["error"] = "Connection failed (anonymous)"
            # Try default credentials
            for u, p in [("admin", "admin"), ("guest", "guest"), ("mqtt", "mqtt")]:
                if self.connect(u, p):
                    result["auth"] = f"{u}:{p}"
                    break
            else:
                return result

        msgs = self.collect()
        result["topics"] = sorted(self.topics)
        result["topic_count"] = len(self.topics)
        result["message_count"] = len(msgs)
        result["messages_sample"] = msgs[:50]  # First 50

        flags = self.search_flags()
        result["flags"] = flags

        self.close()
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MQTT probe")
    parser.add_argument("--host", "-t", required=True)
    parser.add_argument("--port", "-p", type=int, default=1883)
    parser.add_argument("--duration", "-d", type=float, default=10.0, help="Collection duration (seconds)")
    parser.add_argument("--json", "-j", action="store_true")
    parser.add_argument("--pub", nargs=2, metavar=("TOPIC", "PAYLOAD"), help="Publish a message")
    args = parser.parse_args()

    probe = MqttProbe(args.host, args.port, timeout=args.duration)

    if args.pub:
        if not probe.connect():
            sys.exit(1)
        ok = probe.publish(args.pub[0], args.pub[1])
        print("Published" if ok else "Failed")
        probe.close()
    else:
        result = probe.scan_all()
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"MQTT {args.host}:{args.port}")
            print(f"  Topics: {result.get('topic_count', 0)}")
            print(f"  Messages: {result.get('message_count', 0)}")
            for t in result.get("topics", [])[:20]:
                print(f"    {t}")
            for f in result.get("flags", []):
                print(f"  FLAG: {f['flag']} on {f['topic']}")
