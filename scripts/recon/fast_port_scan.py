#!/usr/bin/env python3
"""
Fast port scanner — CTF-relevant ports only.

Scans a predefined set of well-known ports commonly seen in CTF environments
(web, AD, SCADA, DB, remote access). Can accept targets directly or use
the output of fast_scan.py via --from-scan.

Outputs JSON compatible with the web-app importer (FullScanData format).

Dependencies: python-nmap, click, rich
System requirement: nmap (root required for SYN scan)
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
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
)
from rich.table import Table

# ---------------------------------------------------------------------------
# CTF-relevant ports
# ---------------------------------------------------------------------------

CTF_PORTS = (
    "21,22,23,25,53,80,88,111,135,139,161,"
    "389,443,445,502,636,"
    "1433,3306,3389,5432,"
    "5985,5986,"
    "8080,8443,9090,"
    "27017"
)

SERVICE_CATEGORIES: dict[str, set[int]] = {
    "web": {80, 443, 8080, 8443, 9090},
    "scada": {502},
    "ad": {88, 135, 139, 389, 445, 636, 5985, 5986, 3389},
    "db": {1433, 3306, 5432, 27017},
}

CATEGORY_COLORS: dict[str, str] = {
    "web": "green",
    "scada": "red",
    "ad": "blue",
    "db": "magenta",
    "other": "white",
}

console = Console()
_interrupted = False


def _handle_interrupt(signum: int, _frame: Any) -> None:
    global _interrupted
    _interrupted = True
    console.print("\n[bold yellow]Interrupt received — returning partial results...[/]")


def _categorize_port(port: int) -> str:
    for cat, ports in SERVICE_CATEGORIES.items():
        if port in ports:
            return cat
    return "other"


def _load_targets_from_scan(scan_path: str) -> list[str]:
    """Load live host IPs from a fast_scan.py result JSON."""
    path = Path(scan_path)
    if not path.exists():
        console.print(f"[bold red]ERROR:[/] Scan file not found: {scan_path}")
        sys.exit(1)

    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)

    hosts = data.get("hosts", [])
    if isinstance(hosts, list):
        return [h["ip"] for h in hosts if h.get("status") == "up"]
    elif isinstance(hosts, dict):
        return [ip for ip, h in hosts.items() if h.get("status") == "up"]
    return []


@click.command(context_settings={"help_option_names": ["-h", "--help"]})
@click.option("-t", "--target", default=None, help="Target CIDR, range, or comma-separated IPs")
@click.option("--from-scan", "scan_file", default=None, type=click.Path(exists=True),
              help="Load targets from fast_scan.py result JSON")
@click.option("-o", "--output", "output_path", default=None, type=click.Path(), help="Save results to JSON file")
@click.option("-p", "--ports", "custom_ports", default=None, help="Custom port list (overrides default CTF ports)")
def main(target: str | None, scan_file: str | None, output_path: str | None, custom_ports: str | None) -> None:
    """Fast CTF port scanner — well-known ports only."""

    if not target and not scan_file:
        console.print("[bold red]ERROR:[/] Provide --target or --from-scan")
        sys.exit(1)

    if shutil.which("nmap") is None:
        console.print("[bold red]ERROR:[/] nmap is not installed or not on PATH.")
        sys.exit(1)

    is_root = os.geteuid() == 0
    if not is_root:
        console.print(
            "[yellow]WARNING:[/] Not running as root. "
            "SYN scan (-sS) requires root. Falling back to TCP connect (-sT).\n"
        )

    original_handler = signal.getsignal(signal.SIGINT)
    signal.signal(signal.SIGINT, _handle_interrupt)

    # Resolve targets
    if scan_file:
        target_ips = _load_targets_from_scan(scan_file)
        if not target_ips:
            console.print("[yellow]No live hosts found in scan file.[/]")
            signal.signal(signal.SIGINT, original_handler)
            return
        target_str = " ".join(target_ips)
        console.print(f"\n[bold cyan]Fast Port Scan:[/] {len(target_ips)} hosts from {scan_file}")
    else:
        target_str = target  # type: ignore[assignment]
        console.print(f"\n[bold cyan]Fast Port Scan:[/] {target}")

    ports_to_scan = custom_ports or CTF_PORTS
    scan_type = "-sS" if is_root else "-sT"
    arguments = (
        f"{scan_type} -T4 --min-rate 1000 --max-retries 1 "
        f"--host-timeout 30s -n -p {ports_to_scan}"
    )

    console.print(f"[dim]Ports: {ports_to_scan}[/]")

    scanner = nmap.PortScanner()

    with Progress(
        SpinnerColumn(), TextColumn("[progress.description]{task.description}"),
        BarColumn(), TimeElapsedColumn(), console=console, transient=True,
    ) as progress:
        task = progress.add_task("Scanning ports...", total=None)
        try:
            scanner.scan(hosts=target_str, arguments=arguments)
        except nmap.PortScannerError as exc:
            console.print(f"[bold red]Nmap error:[/] {exc}")
            signal.signal(signal.SIGINT, original_handler)
            sys.exit(1)
        finally:
            progress.update(task, completed=True)

    # Build results in importer-compatible format
    hosts: list[dict[str, Any]] = []
    for ip in sorted(scanner.all_hosts()):
        host_entry: dict[str, Any] = {
            "ip": ip,
            "status": scanner[ip].state(),
            "ports": [],
        }
        for proto in scanner[ip].all_protocols():
            for port in sorted(scanner[ip][proto].keys()):
                port_info = scanner[ip][proto][port]
                if port_info["state"] == "open":
                    host_entry["ports"].append({
                        "port": port,
                        "protocol": proto,
                        "state": "open",
                        "service": port_info.get("name", ""),
                    })
        hosts.append(host_entry)

    # Display
    hosts_with_ports = [h for h in hosts if h["ports"]]
    total_ports = sum(len(h["ports"]) for h in hosts)

    table = Table(title=f"Port Scan Results ({len(hosts_with_ports)} hosts, {total_ports} open ports)", border_style="dim")
    table.add_column("Host", style="bold cyan", no_wrap=True)
    table.add_column("Port", justify="right")
    table.add_column("Service", style="yellow")
    table.add_column("Category", style="bold")

    for h in hosts_with_ports:
        first = True
        for p in h["ports"]:
            cat = _categorize_port(p["port"])
            color = CATEGORY_COLORS.get(cat, "white")
            table.add_row(
                h["ip"] if first else "",
                f"{p['port']}/{p['protocol']}",
                p["service"] or "-",
                f"[{color}]{cat.upper()}[/{color}]",
            )
            first = False
        table.add_section()

    if hosts_with_ports:
        console.print(table)
    else:
        console.print("[yellow]No open ports found.[/]")

    # Build output
    results = {
        "scan_time": datetime.now(timezone.utc).isoformat(),
        "target": target or scan_file,
        "scan_type": "fast_port_scan",
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

    # Print JSON to stdout for piping
    print(json.dumps(results, indent=2))

    signal.signal(signal.SIGINT, original_handler)


if __name__ == "__main__":
    main()
