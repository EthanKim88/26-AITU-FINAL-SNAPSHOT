#!/usr/bin/env python3
"""Modbus TCP Scanner -- discover and enumerate Modbus devices on a network.

Designed for CTF/ICS assessment: scans for open port 502, reads device
identification, enumerates all four register types, auto-decodes values,
and searches for flag patterns.

Usage examples:
    python modbus_scanner.py -t 10.10.10.1
    python modbus_scanner.py -t 10.10.10.0/24
    python modbus_scanner.py -t 10.10.10.1 --range 0-9999
    python modbus_scanner.py -t 10.10.10.1 --scan-units
    python modbus_scanner.py -t 10.10.10.1 -o modbus.json
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
import struct
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

import click
from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ModbusException
try:
    # pymodbus >= 3.x
    from pymodbus.pdu.mei_message import ReadDeviceInformationRequest
except ImportError:
    # pymodbus 2.x fallback
    from pymodbus.mei_message import ReadDeviceInformationRequest
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

console = Console()

# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------

DEFAULT_FLAG_PATTERN = r"(?:flag|cremitflag|AITU|AITUCTF|CTF|aitu)\{[^}]+\}"
DEFAULT_API_BASE = "http://localhost:10000"
FLAG_PATTERN_KEYS = (
    "flagFormat",
    "flag_format",
    "flagRegex",
    "flag_regex",
    "FLAG_FORMAT",
)
FLAG_PATTERN_META_KEYS = ("project", "settings", "config", "ctf", "flags", "meta")

COIL_BATCH = 2000
DISCRETE_BATCH = 2000
HOLDING_BATCH = 125
INPUT_BATCH = 125


@dataclass
class RegisterDump:
    """Holds enumerated register data for one register type."""

    register_type: str
    unit_id: int
    values: dict[int, int] = field(default_factory=dict)


@dataclass
class DeviceInfo:
    """Aggregated information for a single Modbus target + unit combo."""

    host: str
    port: int
    unit_id: int
    identification: dict[str, str] = field(default_factory=dict)
    coils: dict[int, int] = field(default_factory=dict)
    discrete_inputs: dict[int, int] = field(default_factory=dict)
    holding_registers: dict[int, int] = field(default_factory=dict)
    input_registers: dict[int, int] = field(default_factory=dict)
    flags_found: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "host": self.host,
            "port": self.port,
            "unit_id": self.unit_id,
            "identification": self.identification,
            "coils": {str(k): v for k, v in self.coils.items()},
            "discrete_inputs": {str(k): v for k, v in self.discrete_inputs.items()},
            "holding_registers": {str(k): v for k, v in self.holding_registers.items()},
            "input_registers": {str(k): v for k, v in self.input_registers.items()},
            "flags_found": self.flags_found,
        }


# ---------------------------------------------------------------------------
# Network helpers
# ---------------------------------------------------------------------------


def expand_targets(target: str) -> list[str]:
    """Expand a target specification into a list of IP strings.

    Accepts: single IP, CIDR notation, or dash-range (10.0.0.1-10).
    """
    target = target.strip()

    # CIDR
    if "/" in target:
        try:
            network = ipaddress.ip_network(target, strict=False)
            return [str(ip) for ip in network.hosts()]
        except ValueError:
            console.print(f"[red]Invalid CIDR notation: {target}[/red]")
            return []

    # Dash-range in last octet: 10.0.0.1-10
    dash_match = re.match(r"^(\d+\.\d+\.\d+\.)(\d+)-(\d+)$", target)
    if dash_match:
        prefix = dash_match.group(1)
        start = int(dash_match.group(2))
        end = int(dash_match.group(3))
        return [f"{prefix}{i}" for i in range(start, end + 1)]

    # Single IP
    try:
        ipaddress.ip_address(target)
        return [target]
    except ValueError:
        # Could be a hostname
        return [target]


def tcp_port_open(host: str, port: int, timeout: float = 2.0) -> bool:
    """Quick TCP connect check."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (OSError, ConnectionRefusedError, TimeoutError):
        return False


def call_with_unit(
    client: ModbusTcpClient, method: str, *args: Any, unit_id: int, **kwargs: Any
) -> Any:
    """Call pymodbus client methods across 2.x/3.x unit-id keyword differences."""
    fn = getattr(client, method)
    try:
        return fn(*args, device_id=unit_id, **kwargs)
    except TypeError:
        return fn(*args, slave=unit_id, **kwargs)


def build_mei_request(read_code: int, unit_id: int) -> ReadDeviceInformationRequest:
    """Build MEI request across pymodbus 2.x/3.x constructor differences."""
    try:
        return ReadDeviceInformationRequest(read_code=read_code, dev_id=unit_id)
    except TypeError:
        return ReadDeviceInformationRequest(read_code=read_code, slave=unit_id)


# ---------------------------------------------------------------------------
# Modbus operations
# ---------------------------------------------------------------------------


def read_device_identification(
    client: ModbusTcpClient, unit_id: int
) -> dict[str, str]:
    """Read Modbus device identification (FC 43 / MEI type 14)."""
    info: dict[str, str] = {}
    object_names = {
        0x00: "VendorName",
        0x01: "ProductCode",
        0x02: "MajorMinorRevision",
        0x03: "VendorUrl",
        0x04: "ProductName",
        0x05: "ModelName",
        0x06: "UserApplicationName",
    }

    for read_code in (1, 2, 3):
        try:
            request = build_mei_request(read_code=read_code, unit_id=unit_id)
            response = client.execute(request)
            if response is None or response.isError():
                continue
            if hasattr(response, "information") and response.information:
                for obj_id, value in response.information.items():
                    name = object_names.get(obj_id, f"Object_{obj_id}")
                    decoded = (
                        value.decode("utf-8", errors="replace")
                        if isinstance(value, bytes)
                        else str(value)
                    )
                    info[name] = decoded
        except (ModbusException, AttributeError, Exception):
            continue

    return info


def read_coils(
    client: ModbusTcpClient,
    unit_id: int,
    start: int,
    end: int,
) -> dict[int, int]:
    """Read coils in batches. Returns {address: value}."""
    result: dict[int, int] = {}
    addr = start
    while addr <= end:
        count = min(COIL_BATCH, end - addr + 1)
        try:
            resp = call_with_unit(
                client, "read_coils", addr, unit_id=unit_id, count=count
            )
            if resp is None or resp.isError():
                addr += count
                continue
            for i, bit in enumerate(resp.bits[:count]):
                result[addr + i] = int(bit)
        except (ModbusException, Exception):
            pass
        addr += count
    return result


def read_discrete_inputs(
    client: ModbusTcpClient,
    unit_id: int,
    start: int,
    end: int,
) -> dict[int, int]:
    """Read discrete inputs in batches."""
    result: dict[int, int] = {}
    addr = start
    while addr <= end:
        count = min(DISCRETE_BATCH, end - addr + 1)
        try:
            resp = call_with_unit(
                client, "read_discrete_inputs", addr, unit_id=unit_id, count=count
            )
            if resp is None or resp.isError():
                addr += count
                continue
            for i, bit in enumerate(resp.bits[:count]):
                result[addr + i] = int(bit)
        except (ModbusException, Exception):
            pass
        addr += count
    return result


def read_holding_registers(
    client: ModbusTcpClient,
    unit_id: int,
    start: int,
    end: int,
) -> dict[int, int]:
    """Read holding registers in batches."""
    result: dict[int, int] = {}
    addr = start
    while addr <= end:
        count = min(HOLDING_BATCH, end - addr + 1)
        try:
            resp = call_with_unit(
                client, "read_holding_registers", addr, unit_id=unit_id, count=count
            )
            if resp is None or resp.isError():
                addr += count
                continue
            for i, val in enumerate(resp.registers):
                result[addr + i] = val
        except (ModbusException, Exception):
            pass
        addr += count
    return result


def read_input_registers(
    client: ModbusTcpClient,
    unit_id: int,
    start: int,
    end: int,
) -> dict[int, int]:
    """Read input registers in batches."""
    result: dict[int, int] = {}
    addr = start
    while addr <= end:
        count = min(INPUT_BATCH, end - addr + 1)
        try:
            resp = call_with_unit(
                client, "read_input_registers", addr, unit_id=unit_id, count=count
            )
            if resp is None or resp.isError():
                addr += count
                continue
            for i, val in enumerate(resp.registers):
                result[addr + i] = val
        except (ModbusException, Exception):
            pass
        addr += count
    return result


# ---------------------------------------------------------------------------
# Decoding helpers
# ---------------------------------------------------------------------------


def decode_float32_pairs(registers: dict[int, int]) -> dict[int, float]:
    """Decode consecutive register pairs as IEEE 754 big-endian floats."""
    floats: dict[int, float] = {}
    sorted_addrs = sorted(registers.keys())
    i = 0
    while i < len(sorted_addrs) - 1:
        a1 = sorted_addrs[i]
        a2 = sorted_addrs[i + 1]
        if a2 == a1 + 1:
            hi = registers[a1]
            lo = registers[a2]
            packed = struct.pack(">HH", hi, lo)
            value = struct.unpack(">f", packed)[0]
            if not (value != value):  # not NaN
                floats[a1] = value
            i += 2
        else:
            i += 1
    return floats


def decode_ascii_from_registers(registers: dict[int, int]) -> str:
    """Decode registers as ASCII (2 chars per 16-bit register)."""
    text_parts: list[str] = []
    for addr in sorted(registers.keys()):
        val = registers[addr]
        hi_byte = (val >> 8) & 0xFF
        lo_byte = val & 0xFF
        for b in (hi_byte, lo_byte):
            if 0x20 <= b <= 0x7E:
                text_parts.append(chr(b))
            else:
                text_parts.append(".")
    return "".join(text_parts)


def search_flags(
    device: DeviceInfo, pattern: str
) -> list[str]:
    """Search all decoded register representations for flag patterns."""
    regex = re.compile(pattern)
    found: list[str] = []

    for reg_name in ("holding_registers", "input_registers"):
        regs: dict[int, int] = getattr(device, reg_name)
        if not regs:
            continue

        # ASCII decode across all registers
        ascii_text = decode_ascii_from_registers(regs)
        for m in regex.finditer(ascii_text):
            flag = m.group(0)
            if flag not in found:
                found.append(flag)

        # Check individual register values as strings
        for addr, val in regs.items():
            val_str = str(val)
            for m in regex.finditer(val_str):
                flag = m.group(0)
                if flag not in found:
                    found.append(flag)

    # Also check coils/discrete as a bit string
    for bit_name in ("coils", "discrete_inputs"):
        bits: dict[int, int] = getattr(device, bit_name)
        if not bits:
            continue
        bit_string = "".join(str(bits[a]) for a in sorted(bits.keys()))
        # Interpret runs of 8 bits as bytes then look for ASCII flag
        byte_chars: list[str] = []
        for i in range(0, len(bit_string) - 7, 8):
            byte_val = int(bit_string[i : i + 8], 2)
            if 0x20 <= byte_val <= 0x7E:
                byte_chars.append(chr(byte_val))
            else:
                byte_chars.append(".")
        coil_text = "".join(byte_chars)
        for m in regex.finditer(coil_text):
            flag = m.group(0)
            if flag not in found:
                found.append(flag)

    # Check device identification strings
    for _key, val in device.identification.items():
        for m in regex.finditer(val):
            flag = m.group(0)
            if flag not in found:
                found.append(flag)

    return found


# ---------------------------------------------------------------------------
# Scanning logic
# ---------------------------------------------------------------------------


def scan_device(
    host: str,
    port: int,
    unit_id: int,
    reg_start: int,
    reg_end: int,
    flag_pattern: str,
    timeout: float,
) -> DeviceInfo | None:
    """Fully enumerate a single Modbus device/unit combination."""
    device = DeviceInfo(host=host, port=port, unit_id=unit_id)

    client = ModbusTcpClient(host, port=port, timeout=timeout)
    if not client.connect():
        return None

    try:
        # Device identification
        console.print(f"  [dim]Unit {unit_id}: reading device identification...[/dim]")
        device.identification = read_device_identification(client, unit_id)

        # Coils
        console.print(f"  [dim]Unit {unit_id}: reading coils {reg_start}-{reg_end}...[/dim]")
        device.coils = read_coils(client, unit_id, reg_start, reg_end)

        # Discrete inputs
        console.print(f"  [dim]Unit {unit_id}: reading discrete inputs {reg_start}-{reg_end}...[/dim]")
        device.discrete_inputs = read_discrete_inputs(client, unit_id, reg_start, reg_end)

        # Holding registers
        console.print(f"  [dim]Unit {unit_id}: reading holding registers {reg_start}-{reg_end}...[/dim]")
        device.holding_registers = read_holding_registers(client, unit_id, reg_start, reg_end)

        # Input registers
        console.print(f"  [dim]Unit {unit_id}: reading input registers {reg_start}-{reg_end}...[/dim]")
        device.input_registers = read_input_registers(client, unit_id, reg_start, reg_end)

        # Flag search
        device.flags_found = search_flags(device, flag_pattern)

    except Exception as exc:
        console.print(f"  [yellow]Unit {unit_id}: error during enumeration: {exc}[/yellow]")
    finally:
        client.close()

    # Return None if we got absolutely nothing
    has_data = (
        device.identification
        or device.coils
        or device.discrete_inputs
        or device.holding_registers
        or device.input_registers
    )
    return device if has_data else None


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------


def display_device(device: DeviceInfo) -> None:
    """Print a rich panel with device information."""
    header = f"[bold cyan]{device.host}:{device.port}[/bold cyan] (Unit ID: {device.unit_id})"

    # Identification
    if device.identification:
        id_table = Table(title="Device Identification", show_lines=True)
        id_table.add_column("Field", style="bold")
        id_table.add_column("Value")
        for k, v in device.identification.items():
            id_table.add_row(k, v)
        console.print(id_table)

    # Summary counts
    summary = Table(title="Register Summary")
    summary.add_column("Type", style="bold")
    summary.add_column("Populated", justify="right")
    summary.add_column("Non-Zero", justify="right", style="yellow")
    for name, regs in [
        ("Coils", device.coils),
        ("Discrete Inputs", device.discrete_inputs),
        ("Holding Registers", device.holding_registers),
        ("Input Registers", device.input_registers),
    ]:
        total = len(regs)
        nonzero = sum(1 for v in regs.values() if v != 0)
        style = "bold green" if nonzero > 0 else ""
        summary.add_row(name, str(total), Text(str(nonzero), style=style))
    console.print(Panel(summary, title=header))

    # Non-zero holding registers detail
    _print_nonzero_registers("Holding Registers (non-zero)", device.holding_registers)
    _print_nonzero_registers("Input Registers (non-zero)", device.input_registers)

    # Float decode for holding registers
    if device.holding_registers:
        floats = decode_float32_pairs(device.holding_registers)
        interesting_floats = {
            a: v
            for a, v in floats.items()
            if abs(v) > 0.001 and abs(v) < 1e10
        }
        if interesting_floats:
            ft = Table(title="Holding Registers - Float32 Decode (interesting)")
            ft.add_column("Address", justify="right")
            ft.add_column("Registers", justify="right")
            ft.add_column("Float32", style="magenta")
            for addr, val in sorted(interesting_floats.items()):
                hi = device.holding_registers.get(addr, 0)
                lo = device.holding_registers.get(addr + 1, 0)
                ft.add_row(str(addr), f"{hi}, {lo}", f"{val:.6f}")
            console.print(ft)

    # ASCII decode for registers
    for label, regs in [
        ("Holding Registers", device.holding_registers),
        ("Input Registers", device.input_registers),
    ]:
        if regs:
            ascii_text = decode_ascii_from_registers(regs)
            printable = ascii_text.replace(".", "")
            if len(printable) > 3:
                console.print(
                    Panel(
                        ascii_text,
                        title=f"{label} - ASCII Decode",
                        border_style="blue",
                    )
                )

    # Non-zero coils
    nonzero_coils = {a: v for a, v in device.coils.items() if v != 0}
    if nonzero_coils:
        ct = Table(title="Coils (set/ON)")
        ct.add_column("Address", justify="right")
        ct.add_column("Value", style="green")
        for addr in sorted(nonzero_coils.keys()):
            ct.add_row(str(addr), "ON")
        console.print(ct)

    # Flags
    if device.flags_found:
        console.print()
        for flag in device.flags_found:
            console.print(
                Panel(
                    f"[bold green]{flag}[/bold green]",
                    title="[bold red]FLAG FOUND[/bold red]",
                    border_style="red",
                )
            )


def _print_nonzero_registers(title: str, regs: dict[int, int]) -> None:
    """Display a table of non-zero register values."""
    nonzero = {a: v for a, v in regs.items() if v != 0}
    if not nonzero:
        return

    table = Table(title=title)
    table.add_column("Address", justify="right", style="bold")
    table.add_column("Raw (dec)", justify="right")
    table.add_column("Hex", justify="right", style="cyan")
    table.add_column("ASCII", style="green")

    for addr in sorted(nonzero.keys()):
        val = nonzero[addr]
        hi = (val >> 8) & 0xFF
        lo = val & 0xFF
        ascii_repr = ""
        for b in (hi, lo):
            ascii_repr += chr(b) if 0x20 <= b <= 0x7E else "."
        table.add_row(
            str(addr),
            str(val),
            f"0x{val:04X}",
            ascii_repr,
        )

    console.print(table)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_range(range_str: str) -> tuple[int, int]:
    """Parse 'start-end' into (start, end) integers."""
    if "-" in range_str:
        parts = range_str.split("-", 1)
        return int(parts[0]), int(parts[1])
    val = int(range_str)
    return val, val


def _normalize_api_base(api_url: str | None) -> str:
    """Return normalized API base URL for context lookup."""
    base = api_url or os.getenv("CTF_OPS_URL") or DEFAULT_API_BASE
    return base.rstrip("/")


def _pick_non_empty_string(value: Any) -> str | None:
    """Return stripped string if non-empty, else None."""
    if isinstance(value, str):
        value = value.strip()
        if value:
            return value
    return None


def _extract_flag_pattern(payload: Any) -> str | None:
    """Extract a flag regex from API context payload if present."""
    if not isinstance(payload, dict):
        return None

    def _from_dict(data: dict[str, Any]) -> str | None:
        for key in FLAG_PATTERN_KEYS:
            candidate = _pick_non_empty_string(data.get(key))
            if candidate:
                return candidate
        for container in FLAG_PATTERN_META_KEYS:
            nested = data.get(container)
            if not isinstance(nested, dict):
                continue
            for key in FLAG_PATTERN_KEYS:
                candidate = _pick_non_empty_string(nested.get(key))
                if candidate:
                    return candidate
        return None

    # Prefer explicit known keys first.
    direct = _from_dict(payload)
    if direct:
        return direct

    # Fallback: deep search for keys like "flag*format|regex|pattern".
    queue: list[Any] = [payload]
    while queue:
        current = queue.pop(0)
        if isinstance(current, dict):
            for key, value in current.items():
                if isinstance(value, (dict, list)):
                    queue.append(value)
                    continue
                if not isinstance(value, str):
                    continue
                key_lower = key.lower()
                if (
                    "flag" in key_lower
                    and any(token in key_lower for token in ("format", "regex", "pattern"))
                ):
                    candidate = value.strip()
                    if candidate:
                        return candidate
        elif isinstance(current, list):
            queue.extend(current)

    return None


def _load_flag_pattern_from_server(api_base: str, timeout: float = 2.0) -> str | None:
    """Load flag regex from server — tries /api/settings?key=flagFormat first, then /api/context."""
    # Try dedicated settings API first
    settings_url = f"{api_base}/api/settings?key=flagFormat"
    try:
        req = Request(settings_url, headers={"Accept": "application/json"})
        with urlopen(req, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
            candidate = _pick_non_empty_string(payload.get("value") if isinstance(payload, dict) else None)
            if candidate:
                return candidate
    except Exception:
        pass

    # Fallback to /api/context
    context_url = f"{api_base}/api/context"
    try:
        req = Request(context_url, headers={"Accept": "application/json"})
        with urlopen(req, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
    except Exception:
        return None
    return _extract_flag_pattern(payload)


def resolve_flag_pattern(cli_pattern: str | None, api_url: str | None) -> tuple[str, str]:
    """Resolve flag pattern in priority order: CLI -> server -> env -> default."""
    if cli_pattern:
        try:
            re.compile(cli_pattern)
        except re.error as exc:
            raise click.BadParameter(
                f"Invalid --flag-pattern regex: {exc}"
            ) from exc
        return cli_pattern, "cli"

    api_base = _normalize_api_base(api_url)
    server_pattern = _load_flag_pattern_from_server(api_base)
    if server_pattern:
        try:
            re.compile(server_pattern)
            return server_pattern, f"server({api_base}/api/context)"
        except re.error as exc:
            console.print(
                f"[yellow]Warning:[/yellow] Invalid server flag format regex ignored: {exc}"
            )

    env_pattern = _pick_non_empty_string(os.getenv("FLAG_FORMAT"))
    if env_pattern:
        try:
            re.compile(env_pattern)
            return env_pattern, "env(FLAG_FORMAT)"
        except re.error as exc:
            console.print(
                f"[yellow]Warning:[/yellow] Invalid FLAG_FORMAT regex ignored: {exc}"
            )

    return DEFAULT_FLAG_PATTERN, "default"


@click.command(context_settings={"help_option_names": ["-h", "--help"]})
@click.option(
    "-t",
    "--target",
    required=True,
    help="Target IP, CIDR (10.10.10.0/24), or range (10.10.10.1-10).",
)
@click.option(
    "-p",
    "--port",
    default=502,
    show_default=True,
    help="Modbus TCP port.",
)
@click.option(
    "--range",
    "reg_range",
    default="0-999",
    show_default=True,
    help="Register address range to scan (e.g. 0-999 or 0-9999).",
)
@click.option(
    "--scan-units",
    is_flag=True,
    default=False,
    help="Scan all Modbus unit IDs (0-247). Slow but thorough.",
)
@click.option(
    "--unit-id",
    default=1,
    show_default=True,
    help="Specific Modbus unit/slave ID to query.",
)
@click.option(
    "--flag-pattern",
    default=None,
    show_default="auto (server context -> FLAG_FORMAT env -> built-in)",
    help="Regex pattern to search for in decoded values.",
)
@click.option(
    "--api-url",
    default=None,
    help="CTF Ops API base URL for context lookup (default: CTF_OPS_URL or http://localhost:10000).",
)
@click.option(
    "-o",
    "--output",
    default=None,
    type=click.Path(),
    help="Save results to JSON file.",
)
@click.option(
    "--timeout",
    default=3.0,
    show_default=True,
    help="Connection timeout in seconds.",
)
def main(
    target: str,
    port: int,
    reg_range: str,
    scan_units: bool,
    unit_id: int,
    flag_pattern: str | None,
    api_url: str | None,
    output: str | None,
    timeout: float,
) -> None:
    """Modbus TCP Scanner -- discover and enumerate Modbus devices."""
    console.print(
        Panel(
            "[bold]Modbus TCP Scanner[/bold]\nSCADA/ICS Enumeration Tool",
            border_style="cyan",
        )
    )

    reg_start, reg_end = parse_range(reg_range)
    hosts = expand_targets(target)
    if not hosts:
        console.print("[red]No valid targets specified.[/red]")
        sys.exit(1)

    resolved_pattern, pattern_source = resolve_flag_pattern(flag_pattern, api_url)

    console.print(f"[bold]Targets:[/bold] {len(hosts)} host(s)")
    console.print(f"[bold]Port:[/bold] {port}")
    console.print(f"[bold]Register range:[/bold] {reg_start}-{reg_end}")
    console.print(f"[bold]Flag pattern:[/bold] {resolved_pattern}")
    console.print(f"[dim]Pattern source: {pattern_source}[/dim]")
    if scan_units:
        console.print("[bold]Unit scan:[/bold] 0-247 (all)")
    else:
        console.print(f"[bold]Unit ID:[/bold] {unit_id}")
    console.print()

    all_devices: list[DeviceInfo] = []
    all_flags: list[str] = []

    for host in hosts:
        console.print(f"[bold yellow]Scanning {host}:{port}...[/bold yellow]")

        if not tcp_port_open(host, port, timeout=timeout):
            console.print(f"  [dim]Port {port} closed or filtered.[/dim]")
            continue

        console.print(f"  [green]Port {port} open.[/green]")

        unit_ids = range(0, 248) if scan_units else [unit_id]

        for uid in unit_ids:
            device = scan_device(
                host, port, uid, reg_start, reg_end, resolved_pattern, timeout
            )
            if device is not None:
                all_devices.append(device)
                all_flags.extend(device.flags_found)
                display_device(device)
            elif scan_units:
                # Suppress per-unit "no data" for unit scans (too noisy)
                pass
            else:
                console.print(
                    f"  [dim]Unit {uid}: no data returned.[/dim]"
                )

    # Final summary
    console.print()
    console.print(
        Panel(
            f"[bold]Scan complete.[/bold]\n"
            f"Hosts scanned: {len(hosts)}\n"
            f"Devices found: {len(all_devices)}\n"
            f"Flags found: {len(all_flags)}",
            border_style="green" if all_flags else "cyan",
        )
    )

    if all_flags:
        console.print("[bold red]All flags:[/bold red]")
        for flag in all_flags:
            console.print(f"  [bold green]{flag}[/bold green]")

    # JSON output
    if output:
        output_path = Path(output)
        data = {
            "scan_time": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "target": target,
            "port": port,
            "register_range": f"{reg_start}-{reg_end}",
            "devices": [d.to_dict() for d in all_devices],
            "flags": all_flags,
        }
        output_path.write_text(json.dumps(data, indent=2))
        console.print(f"\n[bold]Results saved to:[/bold] {output_path}")


if __name__ == "__main__":
    main()
