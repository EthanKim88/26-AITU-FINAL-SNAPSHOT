#!/usr/bin/env python3
"""
Scan & Import — rustscan-based fast network scan with dashboard import.

Phases (each imports immediately):
  1. Segment — find/mark reachable in dashboard
  2. Fast scan — rustscan CTF ports → host discovery + open ports (parallel, fast)
  3. Deep scan (--deep) — nmap -sV -sC on discovered open ports → version/OS

Usage:
  uv run scripts/recon/scan_and_import.py -t 10.10.13.0/27
  uv run scripts/recon/scan_and_import.py -t 10.10.13.0/27 --deep
  uv run scripts/recon/scan_and_import.py -t 10.10.13.0/27 --deep --full-ports
  uv run scripts/recon/scan_and_import.py -t 10.10.13.0/27 --batch 8000 --timeout 800
  uv run scripts/recon/scan_and_import.py -t 10.10.13.0/27 --dry-run
  uv run scripts/recon/scan_and_import.py -t 10.10.13.0/27 -o scan.json

  # Proxy mode (proxychains + TCP only, no rustscan — falls back to socket probes + nmap)
  proxychains4 -q uv run scripts/recon/scan_and_import.py -t 10.1.3.0/24 --proxy-mode

Dependencies: click, rich, requests, (nmap for --deep / --proxy-mode)
System: rustscan, nmap (optional for deep/proxy)
"""

from __future__ import annotations

import ipaddress
import json
import math
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import click
import requests
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TimeElapsedColumn
from rich.table import Table
from rich.panel import Panel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

API_BASE = os.environ.get("CTF_OPS_URL", "http://localhost:10000")

SERVICE_CATEGORIES: dict[str, set[int]] = {
    "web": {80, 443, 8080, 8443, 9090, 3000, 5000, 8000},
    "scada": {
        102,    # S7comm (Siemens)
        502,    # Modbus TCP
        1883,   # MQTT
        2404,   # IEC 60870-5-104
        4840,   # OPC UA
        8883,   # MQTT over TLS
        9600,   # OMRON FINS
        20000,  # DNP3
        44818,  # EtherNet/IP (CIP)
        47808,  # BACnet
    },
    "ad": {88, 135, 139, 389, 445, 636, 5985, 5986, 3389},
    "db": {1433, 3306, 5432, 1521, 27017, 6379},
}

_BASE_PORTS = {21, 22, 23, 25, 53, 111, 161}
_ALL_CATEGORY_PORTS: set[int] = set()
for _ports in SERVICE_CATEGORIES.values():
    _ALL_CATEGORY_PORTS |= _ports
CTF_PORTS = sorted(_BASE_PORTS | _ALL_CATEGORY_PORTS)
CTF_PORTS_STR = ",".join(str(p) for p in CTF_PORTS)

DISCOVERY_PORTS = [22, 80, 443, 445, 502, 1433, 3389, 5985, 8080, 44818, 102, 20000]

CATEGORY_COLORS: dict[str, str] = {
    "web": "green", "scada": "red", "ad": "blue", "db": "magenta", "other": "white",
}

console = Console()
_interrupted = False


def _handle_interrupt(signum: int, _frame: Any) -> None:
    global _interrupted
    _interrupted = True
    console.print("\n[bold yellow]Interrupt — returning partial results...[/]")


def _categorize_port(port: int) -> str:
    for cat, ports in SERVICE_CATEGORIES.items():
        if port in ports:
            return cat
    return "other"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _expand_target_hosts(target: str) -> list[str]:
    hosts: list[str] = []
    for token in target.strip().split():
        if "/" in token:
            try:
                net = ipaddress.ip_network(token, strict=False)
                hosts.extend(str(ip) for ip in net.hosts())
            except ValueError:
                continue
        else:
            hosts.append(token)
    return sorted(set(hosts), key=lambda ip: ipaddress.ip_address(ip))


def _probe_host_tcp(ip: str, ports: list[int], timeout_s: float = 0.6) -> bool:
    for port in ports:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout_s)
        try:
            if sock.connect_ex((ip, port)) == 0:
                return True
        except Exception:
            pass
        finally:
            sock.close()
    return False


def _chunk_list(lst: list, n: int) -> list[list]:
    if n <= 0:
        return [lst]
    size = math.ceil(len(lst) / n)
    return [lst[i : i + size] for i in range(0, len(lst), size)]


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def _api_get(path: str) -> Any | None:
    try:
        r = requests.get(f"{API_BASE}{path}", timeout=10)
        return r.json() if r.ok else None
    except Exception:
        return None


def _api_post(path: str, data: dict) -> Any | None:
    try:
        r = requests.post(f"{API_BASE}{path}", json=data, timeout=30)
        return r.json() if r.ok else None
    except Exception:
        return None


def _api_patch(path: str, data: dict) -> Any | None:
    try:
        r = requests.patch(f"{API_BASE}{path}", json=data, timeout=10)
        return r.json() if r.ok else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Phase 1: Segment
# ---------------------------------------------------------------------------

def _cidr_contains(parent_cidr: str, child_cidr: str) -> bool:
    try:
        parent = ipaddress.ip_network(parent_cidr, strict=False)
        child = ipaddress.ip_network(child_cidr, strict=False)
        return child.subnet_of(parent)
    except ValueError:
        return False


def _cidr_prefix(cidr: str) -> int:
    try:
        return ipaddress.ip_network(cidr, strict=False).prefixlen
    except ValueError:
        return -1


def phase_segment(target: str) -> None:
    cidrs = [t for t in target.strip().split() if "/" in t]
    if not cidrs:
        return

    for cidr in cidrs:
        console.print(f"\n[bold cyan][Phase 1][/] Segment: {cidr}")
        segments = _api_get("/api/segments") or []
        if isinstance(segments, dict):
            segments = segments.get("data", segments.get("segments", []))

        existing = next((s for s in segments if s.get("cidr") == cidr), None)
        if existing:
            seg_id = existing["id"]
            if not existing.get("reachable"):
                _api_patch(f"/api/segments/{seg_id}", {"reachable": True})
                console.print(f"  [green]→ Marked reachable[/]")
            else:
                console.print(f"  [dim]Already exists & reachable[/]")
        else:
            containing = [
                s for s in segments
                if s.get("cidr") and s.get("cidr") != cidr
                and _cidr_contains(str(s.get("cidr")), cidr)
            ]
            if containing:
                parent = max(containing, key=lambda s: _cidr_prefix(str(s.get("cidr"))))
                parent_id = parent.get("id")
                parent_cidr = str(parent.get("cidr"))
                if parent_id and not parent.get("reachable"):
                    _api_patch(f"/api/segments/{parent_id}", {"reachable": True})
                console.print(f"  [green]→ Reused parent segment {parent_cidr}[/]")
                continue

            resp = _api_post("/api/segments", {"name": cidr, "cidr": cidr})
            if resp:
                seg_id = resp.get("data", resp).get("id") if isinstance(resp, dict) else None
                if seg_id:
                    _api_patch(f"/api/segments/{seg_id}", {"reachable": True})
                console.print(f"  [green]→ Created segment (reachable)[/]")
            else:
                console.print(f"  [yellow]→ Failed to create segment[/]")


# ---------------------------------------------------------------------------
# Phase 2: Rustscan fast scan (host discovery + port scan in one shot)
# ---------------------------------------------------------------------------

def _parse_rustscan_greppable(output: str) -> dict[str, list[int]]:
    """Parse rustscan -g output. Format: 'ip -> [port1,port2,...]'"""
    result: dict[str, list[int]] = {}
    for line in output.strip().splitlines():
        line = line.strip()
        if not line or "->" not in line:
            continue
        match = re.match(r"^([\d.]+)\s*->\s*\[(.+?)\]", line)
        if match:
            ip = match.group(1)
            ports_str = match.group(2)
            ports = [int(p.strip()) for p in ports_str.split(",") if p.strip().isdigit()]
            if ports:
                result[ip] = sorted(ports)
    return result


def phase_rustscan(
    target: str,
    batch_size: int,
    timeout_ms: int,
    dry_run: bool,
    full_ports: bool = False,
) -> tuple[list[str], dict[str, list[int]]]:
    """Rustscan: combined host discovery + CTF port scan."""
    port_label = "1-65535" if full_ports else f"{len(CTF_PORTS)} CTF ports"
    console.print(f"\n[bold cyan][Phase 2][/] Rustscan: {target} ({port_label}, batch={batch_size}, timeout={timeout_ms}ms)")

    cmd = [
        "rustscan",
        "-a", target,
        "--batch-size", str(batch_size),
        "--timeout", str(timeout_ms),
        "--tries", "1",
        "--no-config",
        "--no-banner",
        "-g",
        "--scripts", "none",
    ]

    if full_ports:
        cmd.extend(["-r", "1-65535"])
    else:
        cmd.extend(["-p", CTF_PORTS_STR])

    with Progress(
        SpinnerColumn(), TextColumn("{task.description}"),
        TimeElapsedColumn(), console=console, transient=True,
    ) as prog:
        prog.add_task(f"Scanning {target}...", total=None)
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300,
            )
        except subprocess.TimeoutExpired:
            console.print("  [yellow]→ Rustscan timed out (300s)[/]")
            return [], {}
        except FileNotFoundError:
            console.print("[bold red]ERROR:[/] rustscan not found. Install: brew install rustscan")
            sys.exit(1)

    if proc.returncode != 0 and not proc.stdout.strip():
        stderr = proc.stderr.strip()
        if stderr:
            console.print(f"  [yellow]→ rustscan stderr: {stderr[:200]}[/]")
        return [], {}

    host_ports = _parse_rustscan_greppable(proc.stdout)

    if not host_ports:
        console.print("  [yellow]→ No live hosts / open ports[/]")
        return [], {}

    live = sorted(host_ports.keys(), key=lambda ip: ipaddress.ip_address(ip))
    total_ports = sum(len(p) for p in host_ports.values())
    console.print(f"  [green]→ {len(live)} hosts, {total_ports} open ports[/]")

    # Build scan data and import
    hosts_data = []
    for ip in live:
        ports = host_ports[ip]
        hosts_data.append({
            "ip": ip,
            "status": "up",
            "ports": [
                {"port": p, "protocol": "tcp", "state": "open", "service": ""}
                for p in ports
            ],
        })

    scan_data = _build_scan_data(target, hosts_data)
    _print_results(scan_data)

    if not dry_run and hosts_data:
        result = _api_post("/api/import", scan_data)
        if result:
            console.print(f"  [green]→ Imported {len(live)} hosts, {total_ports} ports[/]")
        else:
            console.print(f"  [yellow]→ Import failed (dashboard reachable?)[/]")

    return live, host_ports


# ---------------------------------------------------------------------------
# Phase 2 fallback: proxy mode (socket probes, no rustscan)
# ---------------------------------------------------------------------------

def phase_proxy_scan(
    target: str,
    dry_run: bool,
    workers: int = 128,
) -> tuple[list[str], dict[str, list[int]]]:
    """Proxy mode: TCP socket probes for host discovery + CTF port scan."""
    console.print(f"\n[bold cyan][Phase 2][/] Proxy mode scan: {target} (socket probes, {workers} workers)")

    candidates = _expand_target_hosts(target)
    if not candidates:
        return [], {}

    host_ports: dict[str, list[int]] = {}
    max_workers = max(16, min(workers, len(candidates) * 4))

    with Progress(
        SpinnerColumn(), TextColumn("{task.description}"),
        BarColumn(), TimeElapsedColumn(), console=console, transient=True,
    ) as prog:
        task = prog.add_task("Probing hosts...", total=len(candidates))

        def probe_host_all_ports(ip: str) -> tuple[str, list[int]]:
            open_ports = []
            for port in CTF_PORTS:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(1.0)
                try:
                    if sock.connect_ex((ip, port)) == 0:
                        open_ports.append(port)
                except Exception:
                    pass
                finally:
                    sock.close()
            return ip, open_ports

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(probe_host_all_ports, ip): ip for ip in candidates}
            for future in as_completed(futures):
                ip, ports = future.result()
                if ports:
                    host_ports[ip] = sorted(ports)
                prog.advance(task)

    if not host_ports:
        console.print("  [yellow]→ No live hosts / open ports[/]")
        return [], {}

    live = sorted(host_ports.keys(), key=lambda ip: ipaddress.ip_address(ip))
    total_ports = sum(len(p) for p in host_ports.values())
    console.print(f"  [green]→ {len(live)} hosts, {total_ports} open ports[/]")

    hosts_data = []
    for ip in live:
        hosts_data.append({
            "ip": ip,
            "status": "up",
            "ports": [
                {"port": p, "protocol": "tcp", "state": "open", "service": ""}
                for p in host_ports[ip]
            ],
        })

    scan_data = _build_scan_data(target, hosts_data)
    _print_results(scan_data)

    if not dry_run and hosts_data:
        result = _api_post("/api/import", scan_data)
        if result:
            console.print(f"  [green]→ Imported {len(live)} hosts, {total_ports} ports[/]")
        else:
            console.print(f"  [yellow]→ Import failed[/]")

    return live, host_ports


# ---------------------------------------------------------------------------
# Phase 3: Deep scan (nmap -sV -sC on discovered ports)
# ---------------------------------------------------------------------------

def _deep_scan_host(
    ip: str,
    ports: list[int],
    scan_type: str,
    is_root: bool,
    proxy_mode: bool = False,
) -> dict[str, Any] | None:
    """Deep scan a single host with nmap. Thread-safe (own process)."""
    if _interrupted:
        return None

    import nmap as nmap_mod
    port_str = ",".join(str(p) for p in sorted(ports))
    os_flag = " -O" if (is_root and not proxy_mode) else ""
    no_ping = " -Pn -n" if proxy_mode else " -Pn -n"
    args = f"{scan_type} -sV -sC{os_flag}{no_ping} -p {port_str} -T4 --host-timeout 60s"
    s = nmap_mod.PortScanner()
    try:
        s.scan(hosts=ip, arguments=args)
    except Exception:
        return None
    return _extract_host(s, ip)


def phase_deep(
    live: list[str],
    host_ports: dict[str, list[int]],
    target: str,
    is_root: bool,
    dry_run: bool,
    workers: int,
    proxy_mode: bool = False,
) -> dict[str, Any]:
    """Nmap version + script + OS scan on discovered open ports only."""
    total = sum(len(host_ports.get(ip, [])) for ip in live)
    console.print(f"\n[bold cyan][Phase 3][/] Deep scan: {len(live)} hosts, {total} open ports ({workers} workers)")

    scan_type = "-sT" if proxy_mode else ("-sS" if is_root else "-sT")
    all_results: list[dict[str, Any]] = []

    with Progress(
        SpinnerColumn(), TextColumn("{task.description}"),
        BarColumn(), TimeElapsedColumn(), console=console, transient=True,
    ) as prog:
        task = prog.add_task("Deep scan...", total=len(live))

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(
                    _deep_scan_host, ip,
                    host_ports.get(ip, CTF_PORTS),
                    scan_type, is_root, proxy_mode,
                ): ip
                for ip in live
            }
            for future in as_completed(futures):
                ip = futures[future]
                prog.update(task, description=f"Deep: {ip}")
                entry = future.result()
                if entry:
                    all_results.append(entry)
                prog.advance(task)

    all_results.sort(key=lambda h: h["ip"])
    scan_data = _build_scan_data(target, all_results)
    _print_results(scan_data)

    if not dry_run and all_results:
        result = _api_post("/api/import", scan_data)
        if result:
            total_ports = sum(len(h.get("ports", [])) for h in all_results)
            console.print(f"  [green]→ Imported {len(all_results)} hosts, {total_ports} ports (version/OS)[/]")
        else:
            console.print(f"  [yellow]→ Import failed[/]")

    return scan_data


# ---------------------------------------------------------------------------
# Nmap result extraction (for deep scan)
# ---------------------------------------------------------------------------

_OS_HINTS: list[tuple[str, str]] = [
    ("ubuntu", "Ubuntu Linux"),
    ("debian", "Debian Linux"),
    ("centos", "CentOS Linux"),
    ("red hat", "Red Hat Linux"),
    ("fedora", "Fedora Linux"),
    ("freebsd", "FreeBSD"),
    ("windows server 2022", "Windows Server 2022"),
    ("windows server 2019", "Windows Server 2019"),
    ("windows server 2016", "Windows Server 2016"),
    ("windows server 2012", "Windows Server 2012"),
    ("windows 11", "Windows 11"),
    ("windows 10", "Windows 10"),
    ("windows", "Windows"),
    ("linux", "Linux"),
]


def _extract_host(scanner: Any, ip: str) -> dict[str, Any] | None:
    if ip not in scanner.all_hosts():
        return None

    host_obj = scanner[ip]
    entry: dict[str, Any] = {"ip": ip, "status": host_obj.state(), "ports": []}

    hn = host_obj.hostname()
    if hn:
        entry["hostname"] = hn

    os_matches = host_obj.get("osmatch", [])
    if os_matches:
        entry["os"] = os_matches[0].get("name", "")

    for proto in host_obj.all_protocols():
        for port in sorted(host_obj[proto].keys()):
            pi = host_obj[proto][port]
            if pi["state"] != "open":
                continue

            port_data: dict[str, Any] = {
                "port": port,
                "protocol": proto,
                "state": "open",
                "service": pi.get("name", ""),
            }

            version_parts = []
            for k in ("product", "version", "extrainfo"):
                v = pi.get(k, "")
                if v:
                    version_parts.append(f"({v})" if k == "extrainfo" else v)
            if version_parts:
                port_data["version"] = " ".join(version_parts)

            _infer_os_from_service(pi, entry)

            for _sid, output in pi.get("script", {}).items():
                _parse_script_output(output, entry)

            entry["ports"].append(port_data)

    for script in host_obj.get("hostscript", []):
        _parse_script_output(script.get("output", ""), entry)

    return entry if entry["ports"] else None


def _infer_os_from_service(port_info: dict, entry: dict[str, Any]) -> None:
    if entry.get("os"):
        return
    text = " ".join(port_info.get(k, "") for k in ("product", "extrainfo")).lower()
    for pattern, os_name in _OS_HINTS:
        if pattern in text:
            entry["os"] = os_name
            return
    cpe = port_info.get("cpe", "")
    if cpe:
        cpe_lower = cpe.lower()
        for pattern, os_name in _OS_HINTS:
            if pattern.replace(" ", "_") in cpe_lower or pattern in cpe_lower:
                entry["os"] = os_name
                return


def _parse_script_output(output: str, entry: dict[str, Any]) -> None:
    for line in output.split("\n"):
        line = line.strip()
        if line.startswith("OS:") and not entry.get("os"):
            val = line[3:].strip()
            if val:
                entry["os"] = val
        if line.startswith("Computer name:") and not entry.get("hostname"):
            val = line.split(":", 1)[1].strip().rstrip("\x00")
            if val:
                entry["hostname"] = val
        if line.startswith("NetBIOS name:") and not entry.get("hostname"):
            val = line.split(":", 1)[1].split(",")[0].strip().rstrip("\x00")
            if val and val != "<unknown>":
                entry["hostname"] = val


# ---------------------------------------------------------------------------
# Build & display
# ---------------------------------------------------------------------------

def _build_scan_data(target: str, hosts: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "scan_time": datetime.now(timezone.utc).isoformat(),
        "target": target,
        "scan_type": "full_scan",
        "hosts": hosts,
    }


def _print_results(data: dict[str, Any]) -> None:
    hosts = data["hosts"]
    if not hosts:
        return

    total_ports = sum(len(h.get("ports", [])) for h in hosts)
    if total_ports == 0:
        return

    table = Table(
        title=f"Scan Results — {len(hosts)} hosts, {total_ports} open ports",
        border_style="dim",
    )
    table.add_column("Host", style="bold cyan", no_wrap=True)
    table.add_column("Port", justify="right")
    table.add_column("Service", style="yellow")
    table.add_column("Version", style="dim")
    table.add_column("Cat", style="bold")

    for h in hosts:
        first = True
        hostname = h.get("hostname", "")
        os_info = h.get("os", "")
        label = h["ip"]
        if hostname:
            label += f" ({hostname})"
        if os_info:
            label += f" [{os_info}]"
        for p in h.get("ports", []):
            cat = _categorize_port(p["port"])
            color = CATEGORY_COLORS.get(cat, "white")
            table.add_row(
                label if first else "",
                f"{p['port']}/{p.get('protocol', 'tcp')}",
                p.get("service", "") or "-",
                p.get("version", "") or "-",
                f"[{color}]{cat.upper()}[/{color}]",
            )
            first = False
        table.add_section()

    console.print(table)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

@click.command(context_settings={"help_option_names": ["-h", "--help"]})
@click.option("-t", "--target", required=True, help="Target CIDR (e.g. 10.10.13.0/27)")
@click.option("-w", "--workers", default=4, type=int, show_default=True, help="Parallel nmap workers for deep scan")
@click.option("-o", "--output", "output_path", default=None, type=click.Path(), help="Save final JSON to file")
@click.option("--deep", is_flag=True, default=False, help="Phase 3: nmap version + script scan on open ports")
@click.option("--full-ports", is_flag=True, default=False, help="Scan full 1-65535 port range (rustscan)")
@click.option("--batch", "batch_size", default=4500, type=int, show_default=True, help="Rustscan batch size")
@click.option("--timeout", "timeout_ms", default=1500, type=int, show_default=True, help="Rustscan timeout (ms)")
@click.option("--proxy-mode", is_flag=True, default=False, help="SOCKS/proxy mode (socket probes, no rustscan)")
@click.option("--dry-run", is_flag=True, default=False, help="Scan only, don't import to dashboard")
@click.option("--api-url", default=None, help=f"Dashboard API URL (default: {API_BASE})")
def main(
    target: str, workers: int, output_path: str | None,
    deep: bool, full_ports: bool, batch_size: int, timeout_ms: int,
    proxy_mode: bool, dry_run: bool, api_url: str | None,
):
    """Fast network scan (rustscan) with incremental dashboard import."""
    global API_BASE
    if api_url:
        API_BASE = api_url

    is_root = os.geteuid() == 0

    original_handler = signal.getsignal(signal.SIGINT)
    signal.signal(signal.SIGINT, _handle_interrupt)

    if full_ports:
        deep = True  # full-ports implies deep

    scanner_name = "socket probes (proxy)" if proxy_mode else "rustscan"
    mode = f"FAST ({scanner_name})"
    if deep:
        mode += " + DEEP (nmap -sV -sC)"
    if full_ports:
        mode += " [full-port-range]"

    console.print(Panel(
        f"[bold]Target:[/]   {target}\n"
        f"[bold]Mode:[/]     {mode}\n"
        f"[bold]Batch:[/]    {batch_size} | Timeout: {timeout_ms}ms\n"
        f"[bold]Import:[/]   {'No (dry run)' if dry_run else API_BASE}",
        title="Scan & Import (rustscan)", border_style="bold cyan",
    ))

    # Phase 1: Segment
    if not dry_run:
        phase_segment(target)

    # Phase 2: Fast scan (rustscan or proxy fallback)
    if proxy_mode:
        live, host_ports = phase_proxy_scan(target, dry_run, workers=128)
    else:
        live, host_ports = phase_rustscan(
            target, batch_size, timeout_ms, dry_run, full_ports=full_ports,
        )

    if not live:
        console.print("[yellow]No live hosts. Done.[/]")
        signal.signal(signal.SIGINT, original_handler)
        return

    # Phase 3 (optional): Deep scan with nmap
    last_data = _build_scan_data(target, [
        {"ip": ip, "status": "up", "ports": [
            {"port": p, "protocol": "tcp", "state": "open", "service": ""}
            for p in host_ports.get(ip, [])
        ]} for ip in live
    ])

    if deep and not _interrupted:
        if shutil.which("nmap") is None:
            console.print("[bold red]ERROR:[/] nmap not found (required for --deep)")
            sys.exit(1)
        if not is_root:
            console.print("[yellow]Not root — deep scan uses TCP connect (slower)[/]")
        last_data = phase_deep(
            live, host_ports, target, is_root, dry_run, workers,
            proxy_mode=proxy_mode,
        )

    # Save JSON
    if output_path:
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(last_data, f, indent=2, default=str)
        console.print(f"\n[green]JSON saved: {path.resolve()}[/]")

    signal.signal(signal.SIGINT, original_handler)
    console.print("\n[bold green]Done.[/]")


if __name__ == "__main__":
    main()
