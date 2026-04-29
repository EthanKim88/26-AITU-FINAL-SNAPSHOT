# AITU CTF Final - Multi-Agent Pentesting Orchestration Platform

A **report-based CTF competition platform** powered by AI agents (Claude Code / Codex).
This is a snapshot of the system used in the 2026 AITU CTF Final.

## Overview

Designed for a CTF format where scoring is based on **vulnerability reports** rather than traditional flag capture. Multiple AI agents autonomously explore network segments, discover vulnerabilities, and generate structured reports.

Core components:
- **Operations Dashboard** (Next.js) — Real-time web dashboard managing hosts, credentials, AD, SCADA, reports, and overall operational status
- **MCP Server** — Model Context Protocol server exposing 40+ tools to AI agents
- **Skill System** — Domain-specific autonomous exploitation skills (Web, AD, SCADA, Pivot, Report, etc.)
- **Multi-Agent Coordination** — Task distribution, deduplication, and objective management across multiple agents

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Human Operator                        │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              Claude Code / Codex Agents                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐   │
│  │ solve-web│ │ solve-ad │ │  pivot   │ │solve-scada│   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬──────┘   │
│       └────────────┴────────────┴────────────┘          │
│                         │                               │
│              ┌──────────▼──────────┐                    │
│              │  dispatch-manager   │                    │
│              │  risk-autopilot     │                    │
│              └──────────┬──────────┘                    │
└─────────────────────────┼───────────────────────────────┘
                          │ MCP (stdin/stdout)
┌─────────────────────────▼───────────────────────────────┐
│                   MCP Server                            │
│  tools.ts (40+ tools) │ resources.ts │ prompts.ts       │
└─────────────────────────┬───────────────────────────────┘
                          │ REST API
┌─────────────────────────▼───────────────────────────────┐
│              Operations Dashboard (Next.js)             │
│  ┌────────┐ ┌──────┐ ┌────┐ ┌─────┐ ┌───────┐           │
│  │Network │ │Creds │ │ AD │ │SCADA│ │Reports│  ...      │
│  └────────┘ └──────┘ └────┘ └─────┘ └───────┘           │
│                         │                               │
│              ┌──────────▼──────────┐                    │
│              │  SQLite (Prisma)    │                    │
│              └─────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

## Features

### Operations Dashboard ([detail](web-app/README.md))
- **16 dashboard pages** — Battle Map, Network, Credentials, AD, SCADA, Reports, Timeline, Sessions, and more
- **50+ REST API endpoints** — Full CRUD for hosts, credentials, AD objects, SCADA devices, reports, and action queues
- **MCP Server** — 37 tools, 24 resources, 4 prompt templates for AI agent integration
- **Import subsystem** — Auto-detects and imports nmap, AD enumeration, and SCADA scanner output
- **Real-time** — SSE event stream for live dashboard updates

### Skill System (`.claude/skills/`)

| Skill | Description |
|---|---|
| `solve-web` | Autonomous Web/DMZ exploitation — source collection, code analysis, vulnerability verification, evidence gathering |
| `solve-ad` | Autonomous AD exploitation — BloodHound, Kerberos attacks, password spraying, privilege escalation, DCSync |
| `solve-scada` | SCADA/ICS exploitation — protocol identification, enumeration, value manipulation, evidence gathering |
| `pivot` | Pivoting/tunneling — ligolo-ng/chisel/SSH tunnel setup, internal network discovery |
| `dispatch-manager` | Multi-agent task distribution and coordination |
| `risk-autopilot` | Autonomous orchestrator — automatic objective selection and execution based on MCP state |
| `report-risk` | Automated Risk report generation and dashboard submission |
| `report-bug` | Automated Bug Bounty report generation and dashboard submission |
| `update-host-routes` | Host routing/interface collection and DB synchronization |
| `update-risks` | Risk DB synchronization from risks.md file |

### Multi-Agent Coordination
- **Objective Lock** — Enforces focus on a single objective; unrelated findings are sent to a backlog
- **Dispatch Board** — Tracks host/action assignments per worker, prevents duplicate work
- **OODA Loop** — `get_sitrep` → `claim_action` → execute → `complete_action` → `heartbeat` cycle
- **Codex Compatible** — Same skills usable from both Claude Code and Codex via `.agents/commands/` wrappers

## Tech Stack

### Web Application
- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Database**: SQLite + Prisma ORM (better-sqlite3)
- **UI**: Tailwind CSS, shadcn/ui, XYFlow (graph), Lucide Icons
- **AI Integration**: Model Context Protocol (MCP) SDK

### Python Pentest Toolkit
- **AD**: impacket, bloodhound, certipy-ad, netexec, ldapdomaindump, coercer, lsassy, dploot
- **Network**: nmap, dnspython, smbmap, enum4linux-ng, sshuttle
- **SCADA/ICS**: pymodbus, asyncua (OPC-UA), snap7 (S7), pycomm3 (Allen-Bradley), paho-mqtt, cpppo
- **Web**: flask-unsign, beautifulsoup4, httpx
- **Credential**: pypykatz, dsinternals

## Project Structure

```
.
├── .claude/skills/          # Claude Code skill definitions (10 skills)
├── .agents/                 # Codex compatibility layer
│   ├── commands/            # Codex command wrappers
│   └── state/               # Objective/dispatch state JSON
├── web-app/                 # Operations Dashboard + MCP Server (see web-app/README.md)
│   ├── src/
│   │   ├── app/             # Next.js App Router (16 pages + 50+ API routes)
│   │   ├── components/      # React components (organized by domain)
│   │   ├── lib/             # Utilities, importer plugins
│   │   ├── mcp/             # MCP server (37 tools, 24 resources, 4 prompts)
│   │   └── hooks/           # React custom hooks
│   └── prisma/
│       ├── schema.prisma    # Database schema (32 models, ~650 lines)
│       └── migrations/      # Migration history
├── scripts/                 # Automation scripts
│   ├── recon/               # Network scanning & service discovery
│   ├── ad/                  # Active Directory enumeration
│   ├── scada/               # SCADA/ICS protocol scanners
│   ├── pivot/               # Ligolo-ng tunnel management
│   ├── msf/                 # Metasploit RPC integration
│   ├── report/              # Report evidence packaging
│   ├── templates/           # ICS protocol probe templates
│   ├── util/                # State management (objective, dispatch)
│   └── reset.sh             # Full platform reset script
├── tools/                   # Offensive tooling
│   ├── bins/                # Pre-compiled binaries (not included, see below)
│   ├── scada/               # SCADA protocol template scaffolds
│   ├── krbrelayx/           # Kerberos relay attack framework
│   └── wordlists/           # Small lists included; rockyou.txt not included
├── loots/                   # Extracted artifacts (organized by host/port)
├── .mcp.json                # MCP server auto-discovery config for Claude Code
├── CLAUDE.md                # AI agent operational guide
├── AGENTS.md                # Multi-agent runtime rules
└── pyproject.toml           # Python dependencies (uv)
```

## Getting Started

### Prerequisites

- **Node.js** 20+
- **pnpm** (`npm install -g pnpm`)
- **Python** 3.12+ with **uv** (`pip install uv`)
- **nmap** (`brew install nmap` / `apt install nmap`)

Optional (for specific features):
- **Claude Code CLI** — for AI agent features ([install](https://docs.anthropic.com/en/docs/claude-code))
- **OpenAI Codex CLI** — alternative AI agent runtime
- **Metasploit Framework** + **rbenv** — for `scripts/msf/` integration

### Quick Start

```bash
# 1. Clone and enter the repository
git clone <repo-url>
cd <repo>

# 2. Set up the web dashboard
cd web-app
pnpm install
pnpm db:generate        # Generate Prisma client
pnpm db:migrate         # Create SQLite DB and apply migrations
pnpm dev                # Start dashboard at http://localhost:10000

# 3. (In a separate terminal) Set up Python tools
cd <repo>               # Back to repo root
uv sync                 # Install Python dependencies into .venv/
```

The dashboard is now running at **http://localhost:10000**.

### Using with AI Agents

#### Claude Code

Claude Code auto-discovers the MCP server via `.mcp.json` at the repo root.

```bash
# From the repo root (web-app must be running)
claude                  # Start Claude Code

# Inside Claude Code, use skills directly:
#   /solve-web 10.10.13.10
#   /solve-ad 10.10.13.48
#   /pivot 10.10.13.41
#   /risk-autopilot
```

All skills are defined in `.claude/skills/` and the agent operational guide is in `CLAUDE.md`.

#### Codex

Codex uses the wrapper commands in `.agents/commands/`. The runtime rules are in `AGENTS.md`.

#### Standalone MCP Server

To run the MCP server outside of Claude Code (e.g., for custom integrations):

```bash
cd web-app
pnpm mcp                # Starts MCP server on stdin/stdout
```

See [web-app/README.md](web-app/README.md) for the full MCP tool/resource/prompt reference.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MSFRPC_HOST` | `127.0.0.1` | Metasploit RPC host |
| `MSFRPC_PORT` | `55553` | Metasploit RPC port |
| `MSFRPC_PASS` | `changeme` | Metasploit RPC password |
| `MSFRPC_USER` | `msf` | Metasploit RPC username |

### Reset (Clean State)

Reset the platform to a fresh initial state:

```bash
./scripts/reset.sh          # Interactive (asks for confirmation)
./scripts/reset.sh --force  # Non-interactive
```

This deletes all databases, loots, agent state, and caches, then reinitializes the Prisma database with a fresh schema.

### External Tools (Download Separately)

These are **not included** in the repository due to size. Download and place them if needed:

- **Pre-compiled binaries** (`tools/bins/`) — ligolo-agent, chisel, mimikatz, etc. See [`tools/bins/README.md`](tools/bins/README.md) for the expected directory structure and architecture layout.
- **`rockyou.txt`** (`tools/wordlists/`) — Download from [SecLists](https://github.com/danielmiessler/SecLists/tree/master/Passwords/Leaked-Databases) or similar.

Small utility wordlists (`cirt-default-usernames.txt`, `names.txt`) are included in the repository.

## Network Scope

The platform was designed for a segmented network with four zones:

| Segment | CIDR | Description |
|---|---|---|
| DMZ | `10.10.13.0/27` | Internet-facing services (web apps) |
| DEV | `10.10.13.32/27` | Development infrastructure (CI/CD, repos) |
| CORP | `10.10.13.64/27` | Corporate Active Directory domain |
| Hackcity | `10.10.13.96/27` | OT/SCADA/ICS industrial control systems |

Agents progress through segments via pivoting: `DMZ → DEV → CORP → Hackcity`.

## Scripts

### Reconnaissance (`scripts/recon/`)

| Script | Description |
|---|---|
| `full_scan.py` | Two-phase network scanner (SYN discovery + service/NSE deep scan). Auto-categorizes services (Web, SCADA, AD, DB) and generates quick-win hints. |
| `fast_scan.py` | Lightweight SYN scan without deep service detection for speed-first discovery. |
| `fast_port_scan.py` | Ultra-fast port scanning for top-N or custom port ranges. |
| `scan_and_import.py` | Scan + auto-import to MCP backend via `import_scan_data`. |
| `web_enum.py` | HTTP/HTTPS enumeration — directory brute-force, technology detection, vulnerability checks. |

```bash
uv run scripts/recon/full_scan.py 10.10.13.0/27 --deep
uv run scripts/recon/scan_and_import.py -t 10.10.13.0/27
```

### Active Directory (`scripts/ad/`)

| Script | Description |
|---|---|
| `ad_enum.py` | Two-phase AD enumerator. **Phase 1** (unauthenticated): DNS zone transfer, SMB null session, LDAP anonymous bind, RPC null session. **Phase 2** (authenticated): full LDAP enumeration of users, groups, computers, OUs, GPOs, trusts, password policies. Detects Kerberoastable/ASREPRoastable users and delegation abuse paths. |

```bash
# Unauthenticated (Phase 1 only)
uv run scripts/ad/ad_enum.py -t 10.10.13.65

# Authenticated (Phase 1 + 2)
uv run scripts/ad/ad_enum.py -t 10.10.13.65 -d corp.local -u user -p password
```

### SCADA/ICS (`scripts/scada/`)

| Script | Description |
|---|---|
| `modbus_scanner.py` | Modbus TCP discovery & enumeration — Unit ID scanning, device identification (MEI), full register read, flag pattern extraction. |
| `modbus_rw.py` | Modbus register read/write for value manipulation. |

```bash
uv run scripts/scada/modbus_scanner.py -t 10.10.13.101
uv run scripts/scada/modbus_scanner.py -t 10.10.13.96/27 --scan-units --range 0-9999
```

### ICS Protocol Templates (`scripts/templates/`)

Ready-to-run protocol probes covering major ICS/SCADA protocols:

| Script | Protocol | Default Port |
|---|---|---|
| `modbus_tcp.py` | Modbus TCP | 502 |
| `opcua_client.py` | OPC UA | 4840 |
| `s7comm_client.py` | S7comm (Siemens) | 102 |
| `mqtt_client.py` | MQTT | 1883 |
| `enip_client.py` | EtherNet/IP | 44818 |
| `bacnet_scan.py` | BACnet/IP | 47808 |
| `dnp3_client.py` | DNP3 | 20000 |
| `iec104_client.py` | IEC 60870-5-104 | 2404 |
| `protocol_detect.py` | Auto-detection | — |

```bash
uv run scripts/templates/protocol_detect.py --host 10.10.13.101
uv run scripts/templates/modbus_tcp.py --host 10.10.13.101
```

### Pivoting (`scripts/pivot/`)

A full ligolo-ng lifecycle management suite for macOS:

| Script | Description |
|---|---|
| `ligolo-proxy.sh` | Start ligolo-proxy server with VPN detection, background utun watcher, and auto-guidance. |
| `ligolo-agent.sh` | Deploy ligolo-agent to a remote host via SSH (supports password/key auth, amd64/arm64). |
| `ligolo-tunnel.sh` | High-level tunnel API client — connect agents, configure routes, manage lifecycle via ligolo REST API. |
| `ligolo-route.sh` | Add/remove/view macOS network routes through the ligolo tunnel interface. |
| `ligolo-iface.sh` | Detect and list macOS utun interfaces used by ligolo-ng. |

```bash
./scripts/pivot/ligolo-proxy.sh                                    # Start proxy
./scripts/pivot/ligolo-agent.sh 10.10.13.41 ubuntu 'pass'         # Deploy agent
./scripts/pivot/ligolo-tunnel.sh start 10.10.13.41 utun10 10.10.13.64/27  # Route
```

### Metasploit Integration (`scripts/msf/`)

> Requires: Metasploit Framework + rbenv (not included)

| Script | Description |
|---|---|
| `start_msfrpcd.sh` | Start msfrpcd daemon (port 55553) with rbenv Ruby initialization. |
| `msf_client.py` | CLI wrapper for Metasploit RPC — module search, exploit/auxiliary execution, payload generation, session management. |

```bash
export MSFRPC_PASS="your-password"
./scripts/msf/start_msfrpcd.sh
uv run scripts/msf/msf_client.py search eternalblue
uv run scripts/msf/msf_client.py sessions
```

### Report Generation (`scripts/report/`)

| Script | Description |
|---|---|
| `package_attachments.py` | Bundle evidence files into <=10 MB ZIP archives for report submission. Smart filtering, multi-zip splitting. |

```bash
uv run scripts/report/package_attachments.py /path/to/evidence --report-id risk_abc
```

### Utilities (`scripts/util/`)

| Script | Description |
|---|---|
| `objective_state.sh` | Manage active objective state (`.agents/state/active_objective.json`). Commands: `get`, `set`, `lane`, `backlog`, `clear`. |
| `dispatch_board.sh` | Manage multi-worker dispatch board (`.agents/state/dispatch-board.json`). Commands: `get`, `init`, `assign`, `status`, `reap-stale`. |
| `reset.sh` | Full platform reset — delete DBs, loots, agent state, caches and reinitialize. |

## Tools

### Pre-compiled Binaries (`tools/bins/`)

> Not included in the repository. See [`tools/bins/README.md`](tools/bins/README.md) for the expected directory structure.

Cross-platform offensive binaries organized by architecture (`linux-amd64/`, `linux-arm64/`, `windows-amd64/`, `darwin-arm64/`):

| Binary | Purpose |
|---|---|
| `ligolo-proxy` / `ligolo-agent` | Ligolo-ng TUN-based pivot tunneling |
| `chisel` | HTTP tunnel (SOCKS proxy) |
| `kerbrute` | Kerberos user enumeration & password spraying |
| `socat` | Network relay / reverse shell |
| `pspy64` | Process spy (unprivileged) |
| `linpeas.sh` / `winPEASx64.exe` | Privilege escalation scanners |
| `mimikatz` | Windows credential extraction |
| `SharpHound.exe` | BloodHound data collector |
| `Rubeus.exe` | Kerberos attack toolkit |
| `GodPotato.exe` / `PrintSpoofer64.exe` | Windows LPE exploits |

### SCADA Protocol Templates (`tools/scada/`)

Scaffold templates for building custom SCADA exploits. Copy a template, fill in the TODO blocks, and run:

| Template | Protocol |
|---|---|
| `modbus_template.py` | Modbus TCP |
| `opcua_template.py` | OPC UA |
| `s7comm_template.py` | Siemens S7comm |
| `mqtt_template.py` | MQTT |
| `enip_template.py` | EtherNet/IP (CIP) |
| `bacnet_template.py` | BACnet/IP |
| `dnp3_template.py` | DNP3 |
| `iec104_template.py` | IEC 60870-5-104 |
| `unknown_protocol_template.py` | Generic binary protocol |
| `scada_template_base.py` | Shared base class |
| `protocol_detect_template.py` | Port-to-protocol detection |

### Kerberos Relay (`tools/krbrelayx/`)

Git clone of the [krbrelayx](https://github.com/dirkjanm/krbrelayx) project for advanced Kerberos relay attacks — `printerbug.py` (coerce authentication), `addspn.py` (SPN manipulation), `dnstool.py` (DNS record management).

### Wordlists (`tools/wordlists/`)

| File | Included | Description |
|---|---|---|
| `cirt-default-usernames.txt` | Yes | Default/common AD usernames |
| `names.txt` | Yes | Generic name list for username generation |
| `rockyou.txt` | No (download separately) | RockYou breach wordlist for password cracking |

## How It Works

1. **Reconnaissance** — Agent calls `get_sitrep` to check current state, runs network scans, and stores results via `import_scan_data`
2. **Exploitation** — Domain-specific skills (`solve-web`, `solve-ad`, etc.) discover and exploit vulnerabilities
3. **Pivoting** — Agent pivots into internal networks to discover new segments (`pivot` skill)
4. **Reporting** — Discovered vulnerabilities are automatically written up and submitted via `report-risk` and `report-bug` skills
5. **Coordination** — `dispatch-manager` distributes work across multiple agents; `risk-autopilot` drives autonomous progression

All hosts, credentials, loot, and events are recorded in real time to the dashboard DB through MCP.

## Scoring Model

The competition scoring model this platform was designed for:

- **Risk Report** — Documents a full attack chain. Score decreases by 15% for each duplicate acceptance (floor: 40%)
- **Bug Bounty Report** — Per-host vulnerability report (max 1,500 points per host)
  - LPE 500 | RCE 400 | SQLi 300 | SSTI 300 | XXE 300 | SSRF 200 | Path Traversal/LFI 200 | IDOR 100

## License

This project is provided as-is for educational and research purposes.
