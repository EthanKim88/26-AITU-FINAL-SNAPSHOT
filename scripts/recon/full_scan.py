#!/usr/bin/env python3
"""
Two-phase network scanner for CTF competition initial reconnaissance.

Phase 1 (Fast Sweep): SYN scan to discover live hosts and open ports.
Phase 2 (Deep Scan):  Service version detection and NSE script scan on
                       discovered hosts/ports.

Designed for speed and reliability under CTF network conditions where
timeouts, packet loss, and unstable infrastructure are common.

Dependencies: python-nmap, click, rich, python-dotenv
System requirement: nmap must be installed and accessible.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import click
import nmap
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
)
from rich.table import Table

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SERVICE_CATEGORIES: dict[str, set[int]] = {
    "web": {80, 443, 8080, 8443, 8000, 3000, 5000, 9090},
    "scada": {502, 102, 4840, 20000, 44818, 47808},
    "ad": {88, 389, 636, 445, 135, 5985, 5986, 3389},
    "db": {3306, 5432, 1433, 1521, 27017, 6379},
}

CATEGORY_LABELS: dict[str, str] = {
    "web": "Web Services",
    "scada": "SCADA / ICS",
    "ad": "Active Directory",
    "db": "Databases",
    "other": "Other Services",
}

CATEGORY_COLORS: dict[str, str] = {
    "web": "green",
    "scada": "red",
    "ad": "blue",
    "db": "magenta",
    "other": "white",
}

QUICK_WIN_RULES: list[dict[str, Any]] = [
    {
        "ports": {21},
        "hint": "FTP detected -- check for anonymous login (ftp-anon)",
    },
    {
        "ports": {22},
        "hint": "SSH detected -- try default/common credentials, check version for CVEs",
    },
    {
        "ports": {80, 443, 8080, 8443, 8000, 3000, 5000, 9090},
        "hint": "HTTP service -- run gobuster/feroxbuster, check for known app CVEs",
    },
    {
        "ports": {445},
        "hint": "SMB detected -- enumerate shares (smbclient -L), check for EternalBlue",
    },
    {
        "ports": {3306, 5432, 1433, 1521},
        "hint": "SQL DB exposed -- try default creds, check for unauthenticated access",
    },
    {
        "ports": {6379},
        "hint": "Redis exposed -- check for no-auth access (redis-cli INFO)",
    },
    {
        "ports": {27017},
        "hint": "MongoDB exposed -- check for unauthenticated access",
    },
    {
        "ports": {502, 102, 4840, 20000, 44818, 47808},
        "hint": "SCADA/ICS protocol -- often no auth, read registers / coils directly",
    },
    {
        "ports": {5985, 5986},
        "hint": "WinRM detected -- try evil-winrm with discovered creds",
    },
    {
        "ports": {88},
        "hint": "Kerberos detected -- try AS-REP roasting (GetNPUsers.py)",
    },
    {
        "ports": {389, 636},
        "hint": "LDAP detected -- enumerate with ldapsearch, check for anonymous bind",
    },
    {
        "ports": {3389},
        "hint": "RDP detected -- try xfreerdp with discovered creds, check BlueKeep",
    },
    {
        "ports": {111},
        "hint": "RPCbind detected -- enumerate NFS shares (showmount -e)",
    },
    {
        "ports": {161},
        "hint": "SNMP detected -- try community strings (public/private), snmpwalk",
    },
]

# ---------------------------------------------------------------------------
# Globals for graceful interrupt handling
# ---------------------------------------------------------------------------

console = Console()
_scan_results: dict[str, Any] = {}
_interrupted = False


# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------


def _check_nmap_installed() -> None:
    """Verify that nmap binary is reachable on PATH."""
    if shutil.which("nmap") is None:
        console.print(
            "[bold red]ERROR:[/] nmap is not installed or not on PATH.\n"
            "Install it with: sudo apt install nmap  /  brew install nmap"
        )
        sys.exit(1)


def _check_root_hint() -> None:
    """Warn (but don't block) if not running as root -- SYN scan needs it."""
    if os.geteuid() != 0:
        console.print(
            "[yellow]WARNING:[/] Not running as root. "
            "SYN scan (-sS) requires root privileges.\n"
            "         Falling back to TCP connect scan (-sT) which is slower.\n"
            "         Run with: sudo python full_scan.py ...\n"
        )


def _load_flag_format() -> re.Pattern[str] | None:
    """Load FLAG_FORMAT from .env and compile it to a regex."""
    load_dotenv()
    raw = os.getenv("FLAG_FORMAT")
    if not raw:
        return None
    try:
        return re.compile(raw)
    except re.error as exc:
        console.print(
            f"[yellow]WARNING:[/] Invalid FLAG_FORMAT regex in .env: {exc}"
        )
        return None


def _categorize_port(port: int) -> str:
    """Return the category name for a given port number."""
    for category, ports in SERVICE_CATEGORIES.items():
        if port in ports:
            return category
    return "other"


def _build_version_string(port_data: dict[str, Any]) -> str:
    """Construct a human-readable version string from nmap port data."""
    parts: list[str] = []
    product = port_data.get("product", "")
    version = port_data.get("version", "")
    extrainfo = port_data.get("extrainfo", "")

    if product:
        parts.append(product)
    if version:
        parts.append(version)
    if extrainfo:
        parts.append(f"({extrainfo})")

    return " ".join(parts).strip()


def _search_flags(
    flag_re: re.Pattern[str] | None, text: str
) -> list[str]:
    """Search text for flag patterns. Return list of matches."""
    if flag_re is None or not text:
        return []
    return flag_re.findall(text)


def _generate_quick_wins(
    all_ports: set[int],
) -> list[str]:
    """Return actionable quick-win suggestions based on discovered ports."""
    hints: list[str] = []
    for rule in QUICK_WIN_RULES:
        if rule["ports"] & all_ports:
            hints.append(rule["hint"])
    return hints


# ---------------------------------------------------------------------------
# Scan engine
# ---------------------------------------------------------------------------


def _run_fast_sweep(
    scanner: nmap.PortScanner,
    target: str,
    top_ports: int,
    is_root: bool,
) -> dict[str, Any]:
    """
    Phase 1: Fast SYN (or connect) scan across the target range.

    Returns a dict mapping host IPs to lists of open port dicts.
    """
    scan_type = "-sS" if is_root else "-sT"
    arguments = (
        f"{scan_type} --top-ports {top_ports} "
        f"-T4 --min-rate 1000 --max-retries 1 "
        f"--host-timeout 30s -n"
    )

    console.print(
        f"\n[bold cyan][Phase 1][/] Fast sweep: {target} "
        f"(top {top_ports} ports, {scan_type})"
    )

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TimeElapsedColumn(),
        console=console,
        transient=True,
    ) as progress:
        task = progress.add_task("Scanning...", total=None)
        try:
            scanner.scan(hosts=target, arguments=arguments)
        except nmap.PortScannerError as exc:
            console.print(f"[bold red]Nmap error:[/] {exc}")
            return {}
        finally:
            progress.update(task, completed=True)

    hosts: dict[str, Any] = {}

    for host in scanner.all_hosts():
        host_data: dict[str, Any] = {
            "status": scanner[host].state(),
            "hostname": scanner[host].hostname() or "",
            "ports": [],
        }
        for proto in scanner[host].all_protocols():
            for port in sorted(scanner[host][proto].keys()):
                port_info = scanner[host][proto][port]
                if port_info["state"] == "open":
                    host_data["ports"].append(
                        {
                            "port": port,
                            "state": "open",
                            "service": port_info.get("name", ""),
                            "version": "",
                            "category": _categorize_port(port),
                        }
                    )
        if host_data["ports"]:
            hosts[host] = host_data

    console.print(
        f"[bold green]  -> Found {len(hosts)} host(s) "
        f"with open ports[/]"
    )
    return hosts


def _run_deep_scan(
    scanner: nmap.PortScanner,
    hosts: dict[str, Any],
    is_root: bool,
    flag_re: re.Pattern[str] | None,
) -> tuple[dict[str, Any], list[str]]:
    """
    Phase 2: Service version + script scan on discovered open ports.

    Updates hosts in-place with version info. Returns (hosts, flags_found).
    """
    if not hosts:
        return hosts, []

    scan_type = "-sS" if is_root else "-sT"
    flags_found: list[str] = []

    console.print(
        f"\n[bold cyan][Phase 2][/] Deep scan on {len(hosts)} host(s) "
        f"(-sV -sC)"
    )

    host_list = list(hosts.items())

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TimeElapsedColumn(),
        console=console,
        transient=True,
    ) as progress:
        task = progress.add_task("Deep scanning...", total=len(host_list))

        for ip, host_data in host_list:
            if _interrupted:
                console.print(
                    "[yellow]  Interrupted -- returning partial results[/]"
                )
                break

            open_ports = ",".join(
                str(p["port"]) for p in host_data["ports"]
            )
            progress.update(task, description=f"Scanning {ip} ({open_ports})")

            os_flag = " -O" if is_root else ""
            arguments = (
                f"{scan_type} -sV -sC{os_flag} -p {open_ports} "
                f"-T4 --host-timeout 60s -n"
            )

            try:
                scanner.scan(hosts=ip, arguments=arguments)
            except nmap.PortScannerError as exc:
                console.print(
                    f"[yellow]  Warning: deep scan failed for {ip}: {exc}[/]"
                )
                progress.advance(task)
                continue

            if ip not in scanner.all_hosts():
                progress.advance(task)
                continue

            updated_ports: list[dict[str, Any]] = []
            for proto in scanner[ip].all_protocols():
                for port in sorted(scanner[ip][proto].keys()):
                    port_info = scanner[ip][proto][port]
                    if port_info["state"] != "open":
                        continue

                    version_str = _build_version_string(port_info)
                    service_name = port_info.get("name", "")

                    # Search for flags in version string and scripts
                    banner_text = f"{service_name} {version_str}"
                    script_output = ""
                    if "script" in port_info:
                        for _script_name, script_data in port_info[
                            "script"
                        ].items():
                            script_output += f" {script_data}"

                    for text in (banner_text, script_output):
                        found = _search_flags(flag_re, text)
                        flags_found.extend(found)

                    updated_ports.append(
                        {
                            "port": port,
                            "state": "open",
                            "service": service_name,
                            "version": version_str,
                            "category": _categorize_port(port),
                        }
                    )

            if updated_ports:
                host_data["ports"] = updated_ports

            # Extract OS detection results
            if is_root and ip in scanner.all_hosts():
                os_matches = scanner[ip].get("osmatch", [])
                if os_matches:
                    host_data["os"] = os_matches[0].get("name", "")

            # Update hostname if discovered in deep scan
            if ip in scanner.all_hosts():
                deep_hostname = scanner[ip].hostname()
                if deep_hostname:
                    host_data["hostname"] = deep_hostname

            progress.advance(task)

    console.print("[bold green]  -> Deep scan complete[/]")
    return hosts, flags_found


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------


def _build_summary(hosts: dict[str, Any]) -> dict[str, Any]:
    """Build the summary section of the results."""
    summary: dict[str, Any] = {
        "total_hosts": len(hosts),
        "web": [],
        "scada": [],
        "ad": [],
        "db": [],
        "other": [],
    }

    for ip, host_data in hosts.items():
        for port_entry in host_data.get("ports", []):
            endpoint = f"{ip}:{port_entry['port']}"
            category = port_entry.get("category", "other")
            if category in summary:
                summary[category].append(endpoint)
            else:
                summary["other"].append(endpoint)

    return summary


def _build_results(
    target: str,
    hosts: dict[str, Any],
    flags_found: list[str],
) -> dict[str, Any]:
    """Assemble the complete results dict.

    Converts hosts from internal dict format to array format for importer
    compatibility: [{"ip": "10.1.2.10", "status": "up", "ports": [...]}]
    """
    hosts_array = [{"ip": ip, **data} for ip, data in hosts.items()]
    return {
        "scan_time": datetime.now(timezone.utc).isoformat(),
        "target": target,
        "hosts": hosts_array,
        "summary": _build_summary(hosts),
        "flags_found": flags_found,
    }


def _print_host_table(hosts: dict[str, Any]) -> None:
    """Print a rich table of all discovered hosts and ports."""
    if not hosts:
        console.print("[yellow]No hosts with open ports found.[/]")
        return

    table = Table(
        title="Scan Results",
        show_header=True,
        header_style="bold white",
        border_style="dim",
        pad_edge=True,
    )
    table.add_column("Host", style="bold cyan", no_wrap=True)
    table.add_column("Port", justify="right", style="white")
    table.add_column("State", style="green")
    table.add_column("Service", style="yellow")
    table.add_column("Version", style="white")
    table.add_column("Category", style="bold")

    for ip in sorted(hosts.keys()):
        host_data = hosts[ip]
        first = True
        for port_entry in sorted(host_data["ports"], key=lambda p: p["port"]):
            cat = port_entry["category"]
            color = CATEGORY_COLORS.get(cat, "white")
            table.add_row(
                ip if first else "",
                str(port_entry["port"]),
                port_entry["state"],
                port_entry["service"],
                port_entry["version"] or "-",
                f"[{color}]{cat.upper()}[/{color}]",
            )
            first = False
        table.add_section()

    console.print(table)


def _print_summary(results: dict[str, Any]) -> None:
    """Print the categorized summary panel."""
    summary = results["summary"]

    lines: list[str] = []
    lines.append(f"[bold]Total live hosts:[/] {summary['total_hosts']}")
    lines.append("")

    for cat_key in ("web", "scada", "ad", "db", "other"):
        endpoints = summary.get(cat_key, [])
        label = CATEGORY_LABELS.get(cat_key, cat_key)
        color = CATEGORY_COLORS.get(cat_key, "white")
        count = len(endpoints)
        if count > 0:
            ep_list = ", ".join(endpoints[:15])
            suffix = f" ... (+{count - 15} more)" if count > 15 else ""
            lines.append(
                f"[{color}]{label}[/{color}] ({count}): {ep_list}{suffix}"
            )
        else:
            lines.append(f"[dim]{label} (0): none[/dim]")

    console.print(
        Panel("\n".join(lines), title="Summary", border_style="cyan")
    )

    # Flags
    flags = results.get("flags_found", [])
    if flags:
        flag_lines = "\n".join(f"  [bold red]{f}[/bold red]" for f in flags)
        console.print(
            Panel(
                flag_lines,
                title="FLAGS DETECTED",
                border_style="bold red",
            )
        )

    # Quick wins
    all_ports: set[int] = set()
    hosts_data = results["hosts"]
    items = hosts_data if isinstance(hosts_data, list) else hosts_data.values()
    for host_data in items:
        for p in host_data.get("ports", []):
            all_ports.add(p["port"])

    hints = _generate_quick_wins(all_ports)
    if hints:
        hint_lines = "\n".join(f"  -> {h}" for h in hints)
        console.print(
            Panel(
                hint_lines,
                title="Quick-Win Suggestions",
                border_style="yellow",
            )
        )


def _save_json(results: dict[str, Any], output_path: str) -> None:
    """Write results to a JSON file."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, default=str)
    console.print(f"\n[green]Results saved to:[/] {path.resolve()}")


# ---------------------------------------------------------------------------
# Signal handler
# ---------------------------------------------------------------------------


def _handle_interrupt(signum: int, _frame: Any) -> None:  # noqa: ANN401
    """Handle Ctrl+C gracefully -- print partial results then exit."""
    global _interrupted  # noqa: PLW0603
    _interrupted = True
    console.print(
        "\n[bold yellow]Interrupt received. "
        "Finishing current host and printing partial results...[/]"
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command(context_settings={"help_option_names": ["-h", "--help"]})
@click.option(
    "-t",
    "--target",
    required=True,
    help="Target IP, range (10.10.10.1-50), or CIDR (10.10.10.0/24).",
)
@click.option(
    "--fast",
    "fast_only",
    is_flag=True,
    default=False,
    help="Run Phase 1 (fast sweep) only, skip deep scan.",
)
@click.option(
    "-o",
    "--output",
    "output_path",
    default=None,
    type=click.Path(),
    help="Save results to a JSON file.",
)
@click.option(
    "--top-ports",
    "top_ports",
    default=1000,
    type=click.IntRange(min=1, max=65535),
    show_default=True,
    help="Number of top ports to scan in Phase 1.",
)
def main(
    target: str,
    fast_only: bool,
    output_path: str | None,
    top_ports: int,
) -> None:
    """Two-phase network scanner for CTF reconnaissance.

    Phase 1: Fast SYN sweep to discover live hosts and open ports.
    Phase 2: Deep service version and script scan on discovered targets.
    """
    global _scan_results  # noqa: PLW0603

    # Pre-flight checks
    _check_nmap_installed()
    is_root = os.geteuid() == 0
    _check_root_hint()
    flag_re = _load_flag_format()

    # Register graceful interrupt handler
    original_handler = signal.getsignal(signal.SIGINT)
    signal.signal(signal.SIGINT, _handle_interrupt)

    console.print(
        Panel(
            f"[bold]Target:[/] {target}\n"
            f"[bold]Mode:[/]   {'Fast sweep only' if fast_only else 'Full (fast + deep)'}\n"
            f"[bold]Ports:[/]  top {top_ports}\n"
            f"[bold]Flags:[/]  {flag_re.pattern if flag_re else 'not configured'}",
            title="CTF Recon Scanner",
            border_style="bold cyan",
        )
    )

    scanner = nmap.PortScanner()
    flags_found: list[str] = []

    # Phase 1: Fast sweep
    hosts = _run_fast_sweep(scanner, target, top_ports, is_root)

    if not hosts:
        console.print("[yellow]No live hosts discovered. Exiting.[/]")
        _scan_results = _build_results(target, hosts, flags_found)
        if output_path:
            _save_json(_scan_results, output_path)
        signal.signal(signal.SIGINT, original_handler)
        return

    # Phase 2: Deep scan (unless --fast or interrupted)
    if not fast_only and not _interrupted:
        hosts, flags_found = _run_deep_scan(
            scanner, hosts, is_root, flag_re
        )

    # Build and display results
    _scan_results = _build_results(target, hosts, flags_found)

    console.print()
    _print_host_table(hosts)
    _print_summary(_scan_results)

    if output_path:
        _save_json(_scan_results, output_path)

    # Restore original signal handler
    signal.signal(signal.SIGINT, original_handler)


if __name__ == "__main__":
    main()
