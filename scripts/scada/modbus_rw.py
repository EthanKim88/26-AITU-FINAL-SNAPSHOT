#!/usr/bin/env python3
"""Modbus TCP Read/Write Tool -- interactive register manipulation for CTF exploitation.

Supports all four register types, multiple decode formats, continuous watch
mode, and batch command execution.

Usage examples:
    python modbus_rw.py -t 10.10.10.1 read holding 0-100
    python modbus_rw.py -t 10.10.10.1 read coil 0-50
    python modbus_rw.py -t 10.10.10.1 write holding 100 12345
    python modbus_rw.py -t 10.10.10.1 write coil 0 1
    python modbus_rw.py -t 10.10.10.1 read holding 0-10 --decode float32
    python modbus_rw.py -t 10.10.10.1 read holding 40 --watch --interval 1
    python modbus_rw.py -t 10.10.10.1 --batch commands.txt
"""

from __future__ import annotations

import struct
import sys
import time
from pathlib import Path
from typing import Any

import click
from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ModbusException
from rich.console import Console
from rich.live import Live
from rich.table import Table
from rich.text import Text

console = Console()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

COIL_BATCH = 2000
DISCRETE_BATCH = 2000
HOLDING_BATCH = 125
INPUT_BATCH = 125

DECODE_CHOICES = ("raw", "int16", "uint16", "int32", "uint32", "float32", "ascii")

REGISTER_TYPES = ("holding", "input", "coil", "discrete")


# ---------------------------------------------------------------------------
# Connection management
# ---------------------------------------------------------------------------


def make_client(host: str, port: int, timeout: float) -> ModbusTcpClient:
    """Create and connect a Modbus TCP client, exiting on failure."""
    client = ModbusTcpClient(host, port=port, timeout=timeout)
    if not client.connect():
        console.print(f"[bold red]Failed to connect to {host}:{port}[/bold red]")
        sys.exit(1)
    return client


def call_with_unit(
    client: ModbusTcpClient, method: str, *args: Any, unit_id: int, **kwargs: Any
) -> Any:
    """Call pymodbus client methods across 2.x/3.x unit-id keyword differences."""
    fn = getattr(client, method)
    try:
        return fn(*args, device_id=unit_id, **kwargs)
    except TypeError:
        return fn(*args, slave=unit_id, **kwargs)


# ---------------------------------------------------------------------------
# Address parsing
# ---------------------------------------------------------------------------


def parse_address_spec(spec: str) -> tuple[int, int]:
    """Parse an address spec like '100' or '0-50' into (start, end)."""
    spec = spec.strip()
    if "-" in spec:
        parts = spec.split("-", 1)
        return int(parts[0]), int(parts[1])
    val = int(spec)
    return val, val


# ---------------------------------------------------------------------------
# Read operations
# ---------------------------------------------------------------------------


def read_coils(
    client: ModbusTcpClient, unit_id: int, start: int, end: int
) -> dict[int, int]:
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
    client: ModbusTcpClient, unit_id: int, start: int, end: int
) -> dict[int, int]:
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
    client: ModbusTcpClient, unit_id: int, start: int, end: int
) -> dict[int, int]:
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
    client: ModbusTcpClient, unit_id: int, start: int, end: int
) -> dict[int, int]:
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


def read_registers(
    client: ModbusTcpClient,
    reg_type: str,
    unit_id: int,
    start: int,
    end: int,
) -> dict[int, int]:
    """Dispatch read to the correct function based on register type."""
    dispatch = {
        "holding": read_holding_registers,
        "input": read_input_registers,
        "coil": read_coils,
        "discrete": read_discrete_inputs,
    }
    func = dispatch.get(reg_type)
    if func is None:
        console.print(f"[red]Unknown register type: {reg_type}[/red]")
        return {}
    return func(client, unit_id, start, end)


# ---------------------------------------------------------------------------
# Write operations
# ---------------------------------------------------------------------------


def write_single_coil(
    client: ModbusTcpClient, unit_id: int, address: int, value: int
) -> bool:
    """Write single coil (FC 05). Value should be 0 or 1."""
    try:
        resp = call_with_unit(client, "write_coil", address, bool(value), unit_id=unit_id)
        if resp is None or resp.isError():
            console.print(f"[red]Write coil {address} failed: {resp}[/red]")
            return False
        console.print(
            f"[green]Coil {address} = {'ON' if value else 'OFF'} -- OK[/green]"
        )
        return True
    except (ModbusException, Exception) as exc:
        console.print(f"[red]Write coil {address} error: {exc}[/red]")
        return False


def write_multiple_coils(
    client: ModbusTcpClient, unit_id: int, start: int, values: list[int]
) -> bool:
    """Write multiple coils (FC 15)."""
    try:
        bool_values = [bool(v) for v in values]
        resp = call_with_unit(
            client, "write_coils", start, bool_values, unit_id=unit_id
        )
        if resp is None or resp.isError():
            console.print(f"[red]Write coils {start}+ failed: {resp}[/red]")
            return False
        console.print(
            f"[green]Coils {start}-{start + len(values) - 1} written -- OK[/green]"
        )
        return True
    except (ModbusException, Exception) as exc:
        console.print(f"[red]Write coils error: {exc}[/red]")
        return False


def write_single_register(
    client: ModbusTcpClient, unit_id: int, address: int, value: int
) -> bool:
    """Write single holding register (FC 06)."""
    try:
        resp = call_with_unit(
            client, "write_register", address, value, unit_id=unit_id
        )
        if resp is None or resp.isError():
            console.print(f"[red]Write register {address} failed: {resp}[/red]")
            return False
        console.print(
            f"[green]Holding register {address} = {value} (0x{value:04X}) -- OK[/green]"
        )
        return True
    except (ModbusException, Exception) as exc:
        console.print(f"[red]Write register {address} error: {exc}[/red]")
        return False


def write_multiple_registers(
    client: ModbusTcpClient, unit_id: int, start: int, values: list[int]
) -> bool:
    """Write multiple holding registers (FC 16)."""
    try:
        resp = call_with_unit(
            client, "write_registers", start, values, unit_id=unit_id
        )
        if resp is None or resp.isError():
            console.print(f"[red]Write registers {start}+ failed: {resp}[/red]")
            return False
        console.print(
            f"[green]Holding registers {start}-{start + len(values) - 1} written -- OK[/green]"
        )
        return True
    except (ModbusException, Exception) as exc:
        console.print(f"[red]Write registers error: {exc}[/red]")
        return False


# ---------------------------------------------------------------------------
# Decode helpers
# ---------------------------------------------------------------------------


def decode_value(
    registers: dict[int, int],
    decode_mode: str,
    reg_type: str,
) -> list[dict[str, Any]]:
    """Decode register values according to the specified mode.

    Returns a list of dicts: [{address, raw, decoded, hex}, ...].
    """
    sorted_addrs = sorted(registers.keys())
    rows: list[dict[str, Any]] = []

    if reg_type in ("coil", "discrete"):
        # Binary values -- decode mode has limited meaning
        for addr in sorted_addrs:
            val = registers[addr]
            rows.append(
                {
                    "address": addr,
                    "raw": val,
                    "decoded": "ON" if val else "OFF",
                    "hex": str(val),
                }
            )
        return rows

    if decode_mode == "raw":
        for addr in sorted_addrs:
            val = registers[addr]
            rows.append(
                {
                    "address": addr,
                    "raw": val,
                    "decoded": str(val),
                    "hex": f"0x{val:04X}",
                }
            )

    elif decode_mode == "uint16":
        for addr in sorted_addrs:
            val = registers[addr]
            rows.append(
                {
                    "address": addr,
                    "raw": val,
                    "decoded": str(val),
                    "hex": f"0x{val:04X}",
                }
            )

    elif decode_mode == "int16":
        for addr in sorted_addrs:
            val = registers[addr]
            signed = struct.unpack(">h", struct.pack(">H", val))[0]
            rows.append(
                {
                    "address": addr,
                    "raw": val,
                    "decoded": str(signed),
                    "hex": f"0x{val:04X}",
                }
            )

    elif decode_mode == "uint32":
        i = 0
        while i < len(sorted_addrs) - 1:
            a1 = sorted_addrs[i]
            a2 = sorted_addrs[i + 1]
            if a2 == a1 + 1:
                hi = registers[a1]
                lo = registers[a2]
                packed = struct.pack(">HH", hi, lo)
                val32 = struct.unpack(">I", packed)[0]
                rows.append(
                    {
                        "address": a1,
                        "raw": f"{hi}, {lo}",
                        "decoded": str(val32),
                        "hex": f"0x{val32:08X}",
                    }
                )
                i += 2
            else:
                rows.append(
                    {
                        "address": a1,
                        "raw": registers[a1],
                        "decoded": str(registers[a1]),
                        "hex": f"0x{registers[a1]:04X}",
                    }
                )
                i += 1
        # Handle trailing single register
        if i == len(sorted_addrs) - 1:
            a = sorted_addrs[i]
            rows.append(
                {
                    "address": a,
                    "raw": registers[a],
                    "decoded": str(registers[a]),
                    "hex": f"0x{registers[a]:04X}",
                }
            )

    elif decode_mode == "int32":
        i = 0
        while i < len(sorted_addrs) - 1:
            a1 = sorted_addrs[i]
            a2 = sorted_addrs[i + 1]
            if a2 == a1 + 1:
                hi = registers[a1]
                lo = registers[a2]
                packed = struct.pack(">HH", hi, lo)
                val32 = struct.unpack(">i", packed)[0]
                rows.append(
                    {
                        "address": a1,
                        "raw": f"{hi}, {lo}",
                        "decoded": str(val32),
                        "hex": f"0x{struct.unpack('>I', packed)[0]:08X}",
                    }
                )
                i += 2
            else:
                rows.append(
                    {
                        "address": a1,
                        "raw": registers[a1],
                        "decoded": str(registers[a1]),
                        "hex": f"0x{registers[a1]:04X}",
                    }
                )
                i += 1
        if i == len(sorted_addrs) - 1:
            a = sorted_addrs[i]
            rows.append(
                {
                    "address": a,
                    "raw": registers[a],
                    "decoded": str(registers[a]),
                    "hex": f"0x{registers[a]:04X}",
                }
            )

    elif decode_mode == "float32":
        i = 0
        while i < len(sorted_addrs) - 1:
            a1 = sorted_addrs[i]
            a2 = sorted_addrs[i + 1]
            if a2 == a1 + 1:
                hi = registers[a1]
                lo = registers[a2]
                packed = struct.pack(">HH", hi, lo)
                fval = struct.unpack(">f", packed)[0]
                rows.append(
                    {
                        "address": a1,
                        "raw": f"{hi}, {lo}",
                        "decoded": f"{fval:.6f}",
                        "hex": f"0x{struct.unpack('>I', packed)[0]:08X}",
                    }
                )
                i += 2
            else:
                rows.append(
                    {
                        "address": a1,
                        "raw": registers[a1],
                        "decoded": str(registers[a1]),
                        "hex": f"0x{registers[a1]:04X}",
                    }
                )
                i += 1
        if i == len(sorted_addrs) - 1:
            a = sorted_addrs[i]
            rows.append(
                {
                    "address": a,
                    "raw": registers[a],
                    "decoded": str(registers[a]),
                    "hex": f"0x{registers[a]:04X}",
                }
            )

    elif decode_mode == "ascii":
        # Decode each register as two ASCII chars
        text_parts: list[str] = []
        for addr in sorted_addrs:
            val = registers[addr]
            hi = (val >> 8) & 0xFF
            lo = val & 0xFF
            for b in (hi, lo):
                text_parts.append(chr(b) if 0x20 <= b <= 0x7E else ".")
            rows.append(
                {
                    "address": addr,
                    "raw": val,
                    "decoded": "".join(
                        chr(x) if 0x20 <= x <= 0x7E else "."
                        for x in ((val >> 8) & 0xFF, val & 0xFF)
                    ),
                    "hex": f"0x{val:04X}",
                }
            )
        # Also print the full ASCII string
        full_text = "".join(text_parts)
        if any(c != "." for c in full_text):
            console.print(f"\n[bold]ASCII string:[/bold] {full_text}")

    return rows


# ---------------------------------------------------------------------------
# Display
# ---------------------------------------------------------------------------


def display_results(
    rows: list[dict[str, Any]],
    reg_type: str,
    decode_mode: str,
    show_all: bool = False,
) -> None:
    """Print decoded register values as a rich table."""
    if not rows:
        console.print("[yellow]No data returned.[/yellow]")
        return

    title = f"{reg_type.title()} -- {decode_mode}"
    table = Table(title=title, show_lines=False)
    table.add_column("Address", justify="right", style="bold")
    table.add_column("Raw", justify="right")
    table.add_column("Decoded", style="cyan")
    table.add_column("Hex", justify="right", style="dim")

    for row in rows:
        raw_val = row["raw"]
        is_nonzero = False
        if isinstance(raw_val, int):
            is_nonzero = raw_val != 0
        elif isinstance(raw_val, str) and "," in raw_val:
            is_nonzero = any(int(x.strip()) != 0 for x in raw_val.split(","))

        if not show_all and not is_nonzero:
            continue

        decoded_style = "bold green" if is_nonzero else ""
        table.add_row(
            str(row["address"]),
            str(row["raw"]),
            Text(str(row["decoded"]), style=decoded_style),
            str(row["hex"]),
        )

    if table.row_count == 0:
        console.print("[dim]All values are zero. Use --all to display everything.[/dim]")
        return

    console.print(table)


def build_watch_table(
    rows: list[dict[str, Any]],
    prev_values: dict[int, Any],
    reg_type: str,
    decode_mode: str,
    iteration: int,
) -> Table:
    """Build a table for watch mode with change highlighting."""
    table = Table(
        title=f"WATCH {reg_type.title()} [{decode_mode}] -- poll #{iteration}",
        show_lines=False,
    )
    table.add_column("Address", justify="right", style="bold")
    table.add_column("Raw", justify="right")
    table.add_column("Decoded", style="cyan")
    table.add_column("Hex", justify="right", style="dim")
    table.add_column("Delta", style="yellow")

    for row in rows:
        addr = row["address"]
        prev = prev_values.get(addr)
        changed = prev is not None and prev != row["decoded"]
        delta = ""
        if changed:
            delta = f"{prev} -> {row['decoded']}"

        style = "bold red" if changed else ""
        table.add_row(
            str(addr),
            str(row["raw"]),
            Text(str(row["decoded"]), style=style or "cyan"),
            str(row["hex"]),
            delta,
        )

    return table


# ---------------------------------------------------------------------------
# Watch mode
# ---------------------------------------------------------------------------


def watch_registers(
    client: ModbusTcpClient,
    reg_type: str,
    unit_id: int,
    start: int,
    end: int,
    decode_mode: str,
    interval: float,
) -> None:
    """Continuously poll registers and display changes."""
    prev_values: dict[int, Any] = {}
    iteration = 0

    console.print(
        f"[bold]Watch mode:[/bold] {reg_type} {start}-{end} every {interval}s. "
        f"Press Ctrl+C to stop."
    )

    try:
        with Live(console=console, refresh_per_second=4) as live:
            while True:
                iteration += 1
                regs = read_registers(client, reg_type, unit_id, start, end)
                rows = decode_value(regs, decode_mode, reg_type)
                table = build_watch_table(
                    rows, prev_values, reg_type, decode_mode, iteration
                )
                live.update(table)

                # Update previous values
                for row in rows:
                    prev_values[row["address"]] = row["decoded"]

                time.sleep(interval)
    except KeyboardInterrupt:
        console.print("\n[yellow]Watch stopped.[/yellow]")


# ---------------------------------------------------------------------------
# Batch execution
# ---------------------------------------------------------------------------


def execute_batch(
    client: ModbusTcpClient,
    unit_id: int,
    batch_file: str,
    decode_mode: str,
    show_all: bool,
) -> None:
    """Execute commands from a batch file.

    Format (one per line):
        read holding 0-100
        read coil 0-50
        write holding 100 12345
        write coil 0 1
        write holding 200 100,200,300  (multiple values)
        write coil 10 1,0,1,1          (multiple values)
    Lines starting with # are comments. Empty lines are skipped.
    """
    path = Path(batch_file)
    if not path.exists():
        console.print(f"[red]Batch file not found: {batch_file}[/red]")
        return

    lines = path.read_text().strip().splitlines()
    total = sum(1 for line in lines if line.strip() and not line.strip().startswith("#"))
    console.print(f"[bold]Executing {total} commands from {batch_file}[/bold]\n")

    for line_num, line in enumerate(lines, 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        console.print(f"[dim]--- Command {line_num}: {line} ---[/dim]")
        parts = line.split()
        if len(parts) < 3:
            console.print(f"[red]Invalid command (too few args): {line}[/red]")
            continue

        action = parts[0].lower()
        reg_type = parts[1].lower()

        if reg_type not in REGISTER_TYPES:
            console.print(f"[red]Unknown register type: {reg_type}[/red]")
            continue

        if action == "read":
            addr_spec = parts[2]
            start, end = parse_address_spec(addr_spec)
            regs = read_registers(client, reg_type, unit_id, start, end)
            rows = decode_value(regs, decode_mode, reg_type)
            display_results(rows, reg_type, decode_mode, show_all)

        elif action == "write":
            if len(parts) < 4:
                console.print(f"[red]Write needs address and value(s): {line}[/red]")
                continue
            address = int(parts[2])
            value_str = parts[3]

            if "," in value_str:
                # Multiple values
                values = [int(v.strip()) for v in value_str.split(",")]
                if reg_type == "coil":
                    write_multiple_coils(client, unit_id, address, values)
                elif reg_type == "holding":
                    write_multiple_registers(client, unit_id, address, values)
                else:
                    console.print(
                        f"[red]Cannot write to {reg_type} (read-only)[/red]"
                    )
            else:
                value = int(value_str)
                if reg_type == "coil":
                    write_single_coil(client, unit_id, address, value)
                elif reg_type == "holding":
                    write_single_register(client, unit_id, address, value)
                else:
                    console.print(
                        f"[red]Cannot write to {reg_type} (read-only)[/red]"
                    )
        else:
            console.print(f"[red]Unknown action: {action} (use read/write)[/red]")

        console.print()


# ---------------------------------------------------------------------------
# JSON output
# ---------------------------------------------------------------------------


def results_to_json(
    rows: list[dict[str, Any]],
    reg_type: str,
    decode_mode: str,
    host: str,
    port: int,
    unit_id: int,
) -> dict[str, Any]:
    """Format results as a JSON-serializable dict."""
    import json as _json

    return {
        "host": host,
        "port": port,
        "unit_id": unit_id,
        "register_type": reg_type,
        "decode_mode": decode_mode,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "registers": rows,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.group(
    context_settings={"help_option_names": ["-h", "--help"]},
    invoke_without_command=True,
)
@click.option("-t", "--target", required=True, help="Target IP or hostname.")
@click.option("-p", "--port", default=502, show_default=True, help="Modbus TCP port.")
@click.option(
    "--unit-id", default=1, show_default=True, help="Modbus unit/slave ID."
)
@click.option(
    "--timeout", default=3.0, show_default=True, help="Connection timeout (seconds)."
)
@click.option(
    "--batch",
    default=None,
    type=click.Path(),
    help="Execute commands from a batch file.",
)
@click.option(
    "--decode",
    default="raw",
    type=click.Choice(DECODE_CHOICES, case_sensitive=False),
    show_default=True,
    help="Decode mode for register values.",
)
@click.option(
    "--all",
    "show_all",
    is_flag=True,
    default=False,
    help="Show all values including zeros.",
)
@click.option(
    "-o",
    "--output",
    default=None,
    type=click.Path(),
    help="Save results to JSON file.",
)
@click.pass_context
def cli(
    ctx: click.Context,
    target: str,
    port: int,
    unit_id: int,
    timeout: float,
    batch: str | None,
    decode: str,
    show_all: bool,
    output: str | None,
) -> None:
    """Modbus TCP Read/Write Tool -- interactive register manipulation."""
    ctx.ensure_object(dict)
    ctx.obj["target"] = target
    ctx.obj["port"] = port
    ctx.obj["unit_id"] = unit_id
    ctx.obj["timeout"] = timeout
    ctx.obj["decode"] = decode
    ctx.obj["show_all"] = show_all
    ctx.obj["output"] = output

    if batch:
        client = make_client(target, port, timeout)
        try:
            execute_batch(client, unit_id, batch, decode, show_all)
        finally:
            client.close()
        ctx.exit(0)


@cli.command()
@click.argument("reg_type", type=click.Choice(REGISTER_TYPES, case_sensitive=False))
@click.argument("address")
@click.option(
    "--watch", is_flag=True, default=False, help="Continuously poll and display changes."
)
@click.option(
    "--interval",
    default=1.0,
    show_default=True,
    help="Poll interval in seconds (watch mode).",
)
@click.pass_context
def read(
    ctx: click.Context,
    reg_type: str,
    address: str,
    watch: bool,
    interval: float,
) -> None:
    """Read registers or coils.

    ADDRESS can be a single address (100) or a range (0-100).
    """
    target = ctx.obj["target"]
    port = ctx.obj["port"]
    unit_id = ctx.obj["unit_id"]
    timeout = ctx.obj["timeout"]
    decode_mode = ctx.obj["decode"]
    show_all = ctx.obj["show_all"]
    output = ctx.obj["output"]

    start, end = parse_address_spec(address)
    client = make_client(target, port, timeout)

    try:
        if watch:
            watch_registers(client, reg_type, unit_id, start, end, decode_mode, interval)
        else:
            regs = read_registers(client, reg_type, unit_id, start, end)
            rows = decode_value(regs, decode_mode, reg_type)
            display_results(rows, reg_type, decode_mode, show_all)

            if output:
                import json

                data = results_to_json(
                    rows, reg_type, decode_mode, target, port, unit_id
                )
                Path(output).write_text(json.dumps(data, indent=2))
                console.print(f"\n[bold]Saved to:[/bold] {output}")
    finally:
        client.close()


@cli.command()
@click.argument("reg_type", type=click.Choice(["holding", "coil"], case_sensitive=False))
@click.argument("address", type=int)
@click.argument("values", nargs=-1, required=True)
@click.pass_context
def write(
    ctx: click.Context,
    reg_type: str,
    address: int,
    values: tuple[str, ...],
) -> None:
    """Write to registers or coils.

    ADDRESS is the starting address. VALUES is one or more values to write.
    For multiple values, they are written starting at ADDRESS.

    Examples:
        write holding 100 12345           # Single register
        write holding 100 100 200 300     # Multiple registers starting at 100
        write coil 0 1                    # Single coil ON
        write coil 10 1 0 1 1            # Multiple coils starting at 10
    """
    target = ctx.obj["target"]
    port = ctx.obj["port"]
    unit_id = ctx.obj["unit_id"]
    timeout = ctx.obj["timeout"]

    int_values = []
    for v in values:
        try:
            int_values.append(int(v))
        except ValueError:
            console.print(f"[red]Invalid value: {v} (must be integer)[/red]")
            sys.exit(1)

    client = make_client(target, port, timeout)

    try:
        if reg_type == "coil":
            if len(int_values) == 1:
                write_single_coil(client, unit_id, address, int_values[0])
            else:
                write_multiple_coils(client, unit_id, address, int_values)

        elif reg_type == "holding":
            if len(int_values) == 1:
                write_single_register(client, unit_id, address, int_values[0])
            else:
                write_multiple_registers(client, unit_id, address, int_values)

        # Verify by reading back
        console.print("\n[dim]Verifying...[/dim]")
        end_addr = address + max(len(int_values) - 1, 0)
        regs = read_registers(client, reg_type, unit_id, address, end_addr)
        rows = decode_value(regs, "raw", reg_type)
        display_results(rows, reg_type, "raw", show_all=True)

    finally:
        client.close()


if __name__ == "__main__":
    cli()
