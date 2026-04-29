#!/usr/bin/env python3
"""
Fast host discovery scanner — ping sweep only, no port scan.

Quickly identifies live hosts in a target range using nmap -sn.
Outputs JSON compatible with the web-app importer (FullScanData format).

Dependencies: python-nmap, click, rich
System requirement: nmap (root recommended for ARP/ICMP sweep)
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import click
import nmap
from rich.console import Console
from rich.progress import SpinnerColumn, TextColumn, Progress, TimeElapsedColumn
from rich.table import Table

console = Console()
_interrupted = False


def _handle_interrupt(signum: int, _frame: Any) -> None:
    global _interrupted
    _interrupted = True
    console.print("\n[bold yellow]Interrupt received — returning partial results...[/]")


@click.command(context_settings={"help_option_names": ["-h", "--help"]})
@click.option("-t", "--target", required=True, help="Target CIDR or range (e.g. 10.1.2.0/24)")
@click.option("-o", "--output", "output_path", default=None, type=click.Path(), help="Save results to JSON file")
def main(target: str, output_path: str | None) -> None:
    """Fast host discovery — ping sweep only (nmap -sn)."""

    if shutil.which("nmap") is None:
        console.print("[bold red]ERROR:[/] nmap is not installed or not on PATH.")
        sys.exit(1)

    is_root = os.geteuid() == 0
    if not is_root:
        console.print("[yellow]WARNING:[/] Not running as root. ARP ping may be unavailable.\n")

    original_handler = signal.getsignal(signal.SIGINT)
    signal.signal(signal.SIGINT, _handle_interrupt)

    console.print(f"\n[bold cyan]Fast Host Discovery:[/] {target}")

    scanner = nmap.PortScanner()

    with Progress(
        SpinnerColumn(), TextColumn("[progress.description]{task.description}"),
        TimeElapsedColumn(), console=console, transient=True,
    ) as progress:
        task = progress.add_task("Ping sweep...", total=None)
        try:
            scanner.scan(hosts=target, arguments="-sn -T4 --min-rate 500")
        except nmap.PortScannerError as exc:
            console.print(f"[bold red]Nmap error:[/] {exc}")
            signal.signal(signal.SIGINT, original_handler)
            sys.exit(1)
        finally:
            progress.update(task, completed=True)

    hosts: list[dict[str, Any]] = []
    for ip in sorted(scanner.all_hosts()):
        state = scanner[ip].state()
        if state == "up":
            hosts.append({"ip": ip, "status": "up", "ports": []})

    # Display
    table = Table(title=f"Live Hosts ({len(hosts)})", border_style="dim")
    table.add_column("#", style="dim", width=4)
    table.add_column("IP", style="bold cyan")
    table.add_column("Status", style="green")
    for i, h in enumerate(hosts, 1):
        table.add_row(str(i), h["ip"], h["status"])
    console.print(table)

    # Build output
    results = {
        "scan_time": datetime.now(timezone.utc).isoformat(),
        "target": target,
        "scan_type": "fast_scan",
        "hosts": hosts,
    }

    if output_path:
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(results, fh, indent=2)
        console.print(f"\n[green]Results saved to:[/] {path.resolve()}")
    else:
        console.print(f"\n[dim]Use -o to save results to JSON[/]")

    # Always print JSON to stdout for piping
    print(json.dumps(results, indent=2))

    signal.signal(signal.SIGINT, original_handler)


if __name__ == "__main__":
    main()
