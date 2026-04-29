# CTF Ops — Operations Dashboard & MCP Server

Real-time operations dashboard and MCP (Model Context Protocol) server for the AITU CTF Final multi-agent pentesting platform.

Built with **Next.js 16**, **Prisma (SQLite)**, and the **MCP SDK**, this application serves as both a human-readable dashboard and the central data backend for autonomous AI agents.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                  Claude Code / Codex Agents                  │
│         (skills: solve-web, solve-ad, pivot, ...)            │
└──────────────────────┬───────────────────────────────────────┘
                       │ MCP (stdin/stdout)
┌──────────────────────▼───────────────────────────────────────┐
│                     MCP Server (tsx)                          │
│  server.ts → tools.ts + resources.ts + prompts.ts            │
│              ↓ HTTP (fetch)                                  │
├──────────────────────────────────────────────────────────────┤
│                Next.js 16 (App Router)                        │
│  ┌────────────────────┐    ┌────────────────────────────┐    │
│  │  Dashboard Pages   │    │      API Routes            │    │
│  │  (React 19 + UI)   │    │  /api/hosts, /api/creds,   │    │
│  │                    │    │  /api/ad, /api/scada, ...   │    │
│  └────────────────────┘    └─────────────┬──────────────┘    │
│                                          │                   │
│                              ┌───────────▼──────────┐        │
│                              │  Prisma ORM (SQLite) │        │
│                              │  32 models, 650 lines│        │
│                              └──────────────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

**Data flow:**
- **Dashboard UI** → SWR fetcher → Next.js API routes → Prisma → SQLite
- **MCP Server** → `api-client.ts` (HTTP fetch) → same Next.js API routes → same SQLite DB

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2 (App Router), React 19, TypeScript |
| Database | SQLite + Prisma 7.6 (better-sqlite3) |
| UI | Tailwind CSS 4, shadcn/ui, Lucide Icons |
| Visualization | @xyflow/react (battle map graph) |
| MCP | @modelcontextprotocol/sdk 1.29 |
| Real-time | Server-Sent Events (SSE) |
| Validation | Zod |

## Getting Started

```bash
# Install dependencies
pnpm install

# Set up database
pnpm db:migrate     # Apply Prisma migrations
pnpm db:generate    # Generate Prisma client

# Start dashboard (http://localhost:10000)
pnpm dev

# Start MCP server (standalone, stdin/stdout)
pnpm mcp
```

The MCP server is auto-discovered by Claude Code via the root `.mcp.json`:

```json
{
  "mcpServers": {
    "ctf-ops": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["--silent", "--prefix", "web-app", "mcp"]
    }
  }
}
```

## Project Structure

```
web-app/
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Root layout (global styles, TooltipProvider)
│   │   ├── page.tsx                  # Redirects to /battle-map
│   │   ├── (dashboard)/              # Dashboard route group
│   │   │   ├── layout.tsx            # Sidebar layout
│   │   │   ├── actions/              # Action queue
│   │   │   ├── ad/                   # Active Directory
│   │   │   ├── battle-map/           # Landing page — battle map
│   │   │   ├── credentials/          # Credential vault
│   │   │   ├── ics-scada/            # ICS/SCADA overview
│   │   │   ├── import/               # Scan data import wizard
│   │   │   ├── network/              # Host list + [hostId] detail
│   │   │   ├── notes/                # Operator notes
│   │   │   ├── reports/              # Report builder
│   │   │   ├── scada/                # SCADA devices + [deviceId] detail
│   │   │   ├── sessions/             # AI session tracker
│   │   │   ├── settings/             # Global settings
│   │   │   ├── tasks/                # Human task queue
│   │   │   └── timeline/             # Event timeline
│   │   └── api/                      # REST API (see API Routes below)
│   ├── components/
│   │   ├── ui/                       # shadcn primitives (24 components)
│   │   ├── layout/                   # app-sidebar.tsx
│   │   ├── actions/                  # Action queue UI
│   │   ├── ad/                       # AD enumeration UI
│   │   ├── battle-map/               # Battle map graph (XYFlow)
│   │   ├── credentials/              # Credential matrix table
│   │   ├── import/                   # Import wizard
│   │   ├── network/                  # Host list + detail
│   │   ├── notes/                    # Notes editor
│   │   ├── reports/                  # Report builder + attachments
│   │   ├── scada/                    # SCADA dashboard + device detail
│   │   ├── sessions/                 # Session history
│   │   ├── settings/                 # Settings form
│   │   ├── tasks/                    # Task queue
│   │   └── timeline/                 # Timeline view
│   ├── lib/
│   │   ├── api.ts                    # apiSuccess(), apiError(), parseBody()
│   │   ├── fetcher.ts                # SWR data fetcher
│   │   ├── prisma.ts                 # Prisma singleton
│   │   ├── utils.ts                  # Tailwind cn() utility
│   │   ├── host-routes.ts            # Route table / interface IP parser
│   │   ├── ics-protocols.ts          # ICS protocol definitions
│   │   ├── report.ts                 # Report generation logic
│   │   ├── report-description.ts     # Report markdown templates
│   │   ├── segment-utils.ts          # Network segment utilities
│   │   ├── scada-summary.ts          # SCADA register analysis
│   │   ├── scada-sanitize.ts         # SCADA data sanitization
│   │   └── import/                   # Scanner import subsystem
│   │       ├── detect.ts             # Auto-detect scanner format
│   │       ├── types.ts              # Import type definitions
│   │       └── importers/
│   │           ├── full-scan.ts      # Nmap / full network scan
│   │           ├── ad-enum.ts        # AD enumeration JSON
│   │           ├── modbus-scanner.ts # Modbus device scanner
│   │           ├── modbus-rw.ts      # Modbus read/write results
│   │           ├── protocol-detect.ts # Service protocol detection
│   │           └── scada-template.ts # SCADA template results
│   ├── hooks/
│   │   ├── use-event-stream.ts       # SSE event stream hook
│   │   └── use-mobile.ts             # Mobile detection hook
│   ├── mcp/                          # MCP server
│   │   ├── server.ts                 # Entry point (StdioServerTransport)
│   │   ├── api-client.ts             # HTTP client → Next.js API
│   │   ├── tools.ts                  # 37 tool registrations
│   │   ├── resources.ts              # 17 static + 7 dynamic resources
│   │   └── prompts.ts                # 4 prompt templates
│   └── generated/                    # Prisma auto-generated client
├── prisma/
│   ├── schema.prisma                 # 32 models (~650 lines)
│   ├── migrations/                   # 18 migration files
│   └── ctf-ops.db                    # SQLite database
├── package.json
├── tsconfig.json
├── next.config.ts
├── prisma.config.ts
├── components.json                   # shadcn/ui config
└── postcss.config.mjs
```

## Dashboard Pages

| Page | Route | Description |
|---|---|---|
| Battle Map | `/battle-map` | Landing page — attack surface graph visualization (XYFlow) with segment stats and credential summary |
| Network | `/network` | Host/port/service inventory with network segment visualization |
| Host Detail | `/network/[hostId]` | Single host view: ports, routes, credential accesses, checklists |
| Credentials | `/credentials` | Credential vault — plaintext/hash/NTLM/Kerberos with access test matrix |
| Active Directory | `/ad` | Domain, user, group, computer, trust, GPO, delegation enumeration |
| SCADA | `/scada` | SCADA device list with register counts |
| SCADA Detail | `/scada/devices/[deviceId]` | Register viewer: type, address, raw/hex/decoded values |
| ICS/SCADA | `/ics-scada` | ICS protocol overview and summary |
| Actions | `/actions` | Priority-based action queue with claim/release and deduplication |
| Reports | `/reports` | Risk / Bug Bounty report builder with attachment management |
| Timeline | `/timeline` | Full operational event audit log |
| Sessions | `/sessions` | AI agent session management (heartbeat, task history) |
| Tasks | `/tasks` | Human operator task request queue |
| Import | `/import` | Scanner data import wizard (auto-detect format) |
| Notes | `/notes` | Operator notes (markdown, tags, host associations) |
| Settings | `/settings` | Global key-value configuration |

## API Routes

All routes are under `/api/`.

### Hosts & Network

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/hosts` | List all hosts with ports, segments, routes, credential accesses |
| POST | `/api/hosts` | Add a new host |
| GET | `/api/hosts/[hostId]` | Host detail with all relationships |
| PATCH | `/api/hosts/[hostId]` | Update host |
| GET/POST | `/api/host-routes` | Host routing & interface records |
| POST | `/api/host-routes/discover` | Parse raw route/interface output |
| GET/POST | `/api/segments` | Network segment management |
| GET/POST | `/api/pivot-routes` | Pivot tunnel routes |
| GET | `/api/pivot-routes/chain?target=SEGMENT` | Compute pivot chain to target segment |

### Credentials

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/credentials` | List all credentials |
| POST | `/api/credentials` | Add credential |
| GET | `/api/credentials/[credId]` | Credential detail |
| GET | `/api/credentials/[credId]/access` | Access matrix for credential |
| POST | `/api/credentials/[credId]/access` | Add access test record |
| PATCH | `/api/credentials/[credId]/access/[accessId]` | Update access status |

### Active Directory

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/ad` | All AD domains with counts |
| GET | `/api/ad/[domainId]` | Domain detail (users, groups, computers, trusts, GPOs) |
| GET | `/api/ad/summary` | Quick AD summary stats |

### SCADA/ICS

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/scada` | All SCADA devices |
| GET | `/api/scada/[deviceId]` | Device detail with registers |
| POST | `/api/scada/[deviceId]/registers` | Record register values |
| GET | `/api/scada/summary` | SCADA summary stats |

### Data Management

| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/loot` | Extracted files (DB dumps, configs, source code) |
| GET | `/api/loot/[id]` | Loot file detail with content |
| GET/POST | `/api/notes` | Operator notes |
| GET/POST | `/api/events` | Timeline events |
| GET | `/api/events/stream` | SSE stream for real-time event notifications |
| POST | `/api/import` | Auto-detect & import scanner JSON |

### Action Queue

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/actions?status=pending&category=ad` | List actions (filterable by status/category) |
| POST | `/api/actions` | Create action (dedup via fingerprint) |
| PATCH | `/api/actions/[actionId]` | Update action status |
| DELETE | `/api/actions/[actionId]` | Delete action |

### Checklists & Sessions

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/checklists` | Per-host attack checklists |
| POST | `/api/checklists/claim` | Claim a host for work |
| PATCH | `/api/checklists/[checklistId]` | Update phase status |
| GET/POST | `/api/sessions` | AI work sessions |
| GET | `/api/sessions/[sessionId]` | Session detail + entry timeline |
| POST | `/api/sessions/[sessionId]/entries` | Log session entries |
| GET/POST | `/api/tasks` | Task requests for human operator |

### Reports

| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/reports` | Bug bounty & risk reports |
| GET/PATCH | `/api/reports/[reportId]` | Report detail & update |
| POST | `/api/reports/[reportId]/attachments` | Attach evidence files |
| DELETE | `/api/reports/[reportId]/attachments/[attachmentId]` | Remove attachment |
| GET/POST | `/api/report/bug-types` | Bug type definitions with point values |
| GET/POST | `/api/report/risks` | Risk category definitions |

### Dashboards & Analysis

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/dashboard` | Battle map summary (segments + credentials) |
| GET | `/api/context` | Full engagement summary |
| GET | `/api/situational-awareness` | SITREP with auto-generated next actions |
| GET | `/api/attack-surface` | Unexplored hosts, roastable users, recommendations |
| GET | `/api/settings` | Global settings (key-value) |

## MCP Server

The MCP server (`src/mcp/server.ts`) bridges AI agents to the dashboard via the [Model Context Protocol](https://modelcontextprotocol.io/). It communicates with agents over **stdin/stdout** and calls the Next.js API routes internally via HTTP.

```bash
# Start standalone
pnpm mcp

# Auto-discovered by Claude Code via root .mcp.json
```

### Tools (37)

#### Situational Awareness

| Tool | Description |
|---|---|
| `get_sitrep` | Full situational awareness: summary, prioritized next actions, state snapshot. Call this first at every decision point. |

#### Action Queue

| Tool | Description |
|---|---|
| `claim_action` | Claim a pending action. Returns 409 if already claimed. Atomic and safe for concurrent use. |
| `complete_action` | Mark an action as `done` or `failed` with a result summary. |
| `retry_action` | Re-open a done/failed action for retry. |
| `list_actions` | List actions filtered by status and/or category. |

#### Import

| Tool | Description |
|---|---|
| `import_scan_data` | Import scanner JSON. Auto-detects: `full-scan`, `modbus-scanner`, `modbus-rw`, `ad-enum`. |

#### Host Management

| Tool | Description |
|---|---|
| `add_host` | Add a new host (IP, hostname, OS, domain, SMB signing, DC flag). |
| `update_host` | Update existing host information. |
| `add_host_route` | Add or update a host route/interface record. |
| `discover_host_routes` | Parse raw `ip route`/`ip addr`/`ifconfig` output and store routes. |
| `list_host_routes` | List saved host route/interface records. |

#### Credential Management

| Tool | Description |
|---|---|
| `add_credential` | Register a credential (password, hash, ticket, SSH key) with source tracking. |
| `test_credential_access` | Record credential access test result (host+protocol+port). Upsert. |
| `update_access_status` | Update an existing access test result. |

#### Loot

| Tool | Description |
|---|---|
| `add_loot` | Save extracted loot to disk and register metadata. Stored under `loots/<hostIp>/[<port>/]`. |
| `get_loot` | Get loot metadata and file content by ID. |
| `list_loot` | List loot items, optionally filtered by host or type. |

#### Events & Notes

| Tool | Description |
|---|---|
| `log_event` | Log an event to the timeline (type: `scan`, `exploit`, `credential`, `note`, `config`). |
| `add_note` | Add an operator note (markdown, tags, host association). |

#### Checklist

| Tool | Description |
|---|---|
| `create_checklist` | Create an attack checklist for a host (enum → exploit → privesc). |
| `update_checklist` | Update checklist phase status. Timestamps auto-set. |
| `claim_host` | Claim a host and start enumeration. Creates checklist if needed. Returns 409 if claimed. |

#### Network Segments & Pivoting

| Tool | Description |
|---|---|
| `add_segment` | Add a network segment (global or host-local scope). |
| `update_segment_reachability` | Mark segment as directly reachable. |
| `add_pivot_route` | Register a pivot route through a dual-homed host. |
| `update_pivot_route` | Update pivot route (protocol, status, credential). |
| `delete_pivot_route` | Delete a pivot route. |
| `get_pivot_chain` | Compute full pivot chain to target segment with auto-generated tunnel commands. |

#### Session Management

| Tool | Description |
|---|---|
| `start_session` | Start a new AI work session. |
| `resume_session` | Resume session — returns recent entries + pending tasks (compact). |
| `log_session_entry` | Log a step to the current session (type: `action`, `analysis`, `request`, `result`, `decision`, `note`). |
| `heartbeat` | Heartbeat signal. Sessions without heartbeat for 5+ minutes are marked stale. |
| `pause_session` | Pause a session (waiting for human task). |
| `complete_session` | Mark session as completed with a summary. |
| `list_sessions` | List all sessions with task counts. |

#### Task Requests

| Tool | Description |
|---|---|
| `request_task` | Request human operator to perform a task (type: `scan`, `crack`, `exploit`, `spray`, `collect`, `manual`). |
| `complete_task` | Mark a task as done and record result. |
| `list_pending_tasks` | List pending task requests. |

### Resources

Static resources providing read-only access to operational state.

| URI | Description |
|---|---|
| `ctf://sitrep` | Situational awareness: summary + prioritized next actions + state snapshot |
| `ctf://context` | Engagement summary: hosts, credentials, AD, SCADA stats |
| `ctf://attack-surface` | Attack surface analysis: unexplored hosts, SMB signing, roastable users, recommendations |
| `ctf://dashboard` | Battle map data: segment stats and credential summary |
| `ctf://hosts` | All hosts with ports, segments, routes, credential accesses |
| `ctf://host-routes` | All host route/interface IP records |
| `ctf://credentials` | All credentials with access matrix |
| `ctf://checklists` | Per-host attack checklists |
| `ctf://ad` | AD domains with user/group/computer/trust/GPO counts |
| `ctf://scada` | SCADA devices with register counts |
| `ctf://loot` | All loot items with host associations |
| `ctf://notes` | Operator notes with tags |
| `ctf://timeline` | Recent events timeline |
| `ctf://sessions` | All AI sessions with task counts |
| `ctf://tasks` | All task requests |
| `ctf://tasks/pending` | Pending task requests only |
| `ctf://pivot-routes` | All pivot routes between segments |

Dynamic resource templates:

| URI Template | Description |
|---|---|
| `ctf://hosts/{hostId}` | Host detail: ports, routes, credential accesses, checklists |
| `ctf://host-routes/{hostId}` | Route/interface records for a specific host |
| `ctf://ad/{domainId}` | AD domain detail: users, groups, computers, trusts, GPOs, attack recommendations |
| `ctf://scada/{deviceId}` | SCADA device registers: type, address, raw/hex/decoded values |
| `ctf://sessions/{sessionId}` | Session detail with entry timeline and tasks |
| `ctf://loot/{lootId}` | Loot item detail with file content |
| `ctf://pivot-chain/{segmentName}` | Computed pivot chain to reach target segment with tunnel commands |

### Prompts

Pre-built prompt templates for structured analysis.

| Prompt | Description |
|---|---|
| `triage` | Analyze current engagement and recommend prioritized next actions (Tier 1 immediate + Tier 2 mid-term) |
| `analyze_host` | Develop attack strategy for a specific host based on ports, credentials, and AD context |
| `credential_spray_plan` | Analyze credential matrix and plan spray against untested combinations, ranked by success probability |
| `scada_analysis` | Analyze SCADA registers across all devices for anomalies, ASCII-decodable values, and suspicious patterns |

## Database Schema

32 Prisma models organized by domain:

### Network Infrastructure
- **Host** — Primary host record (IP, hostname, OS, domain, SMB signing, DC flag)
- **Port** — Service ports with version info
- **NetworkSegment** — CIDR ranges with ownership and reachability
- **HostSegment** — Host ↔ Segment mapping with per-segment IP
- **HostRoute** — Routing table entries (destination, gateway, interface, connected IP)
- **PivotRoute** — Tunnel route: fromSegment → pivotHost → toSegment with protocol/credential

### Credentials & Access
- **Credential** — Username + secret (type: password, hash, ntlm, ticket)
- **CredentialAccess** — Access test matrix: Credential × Host × Protocol → status + isAdmin

### Active Directory
- **AdDomain** — Domain with DC IP, functional level, DNS, OU list
- **AdUser** — User with kerberoastable, ASREPRoastable, admin flags, SPN
- **AdGroup** — Group with DN, member list, member count
- **AdComputer** — Computer with OS, delegation flags (unconstrained, constrained, RBCD)
- **AdTrust** — Domain trust relationships (direction, type)
- **AdGpo** — Group Policy Objects

### SCADA/ICS
- **ScadaDevice** — Device record (host, port, unitId, vendor, product, device type)
- **ScadaRegister** — Register value (type, address, raw/hex/decoded, flag match)

### Operations
- **AttackChecklist** — Per-host attack phases (enum, exploit, privesc, flag) with timestamps
- **ActionItem** — Auto-generated action with priority, category, fingerprint dedup, claim tracking
- **Event** — Timeline events (scan, exploit, import) with JSON data
- **Flag** — Captured flags with source, category, points
- **Loot** — Extracted files (type, filename, path, source, port, size)
- **Note** — Freeform notes (markdown, tags, host association)

### AI Sessions
- **AiSession** — Work session (title, status, goal, heartbeat)
- **AiSessionEntry** — Session log entry (type, content, data)
- **TaskRequest** — Delegated task (type, priority, status, expected output, result)
- **ScanJob** — Scan execution tracking (script type, args, stdout/stderr, exit code)

### Reporting
- **Report** — Bug bounty or risk report (target IP, markdown description, status)
- **ReportAttachment** — Evidence file (screenshot, text, script, log)
- **ReportBugType** — Bug type definition with point values
- **ReportRisk** — Risk category definition with points

### Configuration
- **Setting** — Global key-value store

## Import Subsystem

The import system (`src/lib/import/`) auto-detects scanner output format and creates/updates hosts, ports, SCADA devices, and AD objects.

Supported formats:

| Format | Source | Creates |
|---|---|---|
| `full-scan` | `scripts/recon/full_scan.py` | Hosts, ports, services, network segments |
| `ad-enum` | `scripts/ad/ad_enum.py` | AD domains, users, groups, computers, trusts, GPOs |
| `modbus-scanner` | `scripts/scada/modbus_scanner.py` | SCADA devices, registers |
| `modbus-rw` | `scripts/scada/modbus_rw.py` | SCADA register values |
| `protocol-detect` | `scripts/templates/protocol_detect.py` | Port service identification |
| `scada-template` | `scripts/templates/*.py` | SCADA device data |

Usage:

```bash
# Via MCP tool
# AI agents call import_scan_data(format, data)

# Via API
curl -X POST http://localhost:10000/api/import \
  -H "Content-Type: application/json" \
  -d @scan_results.json

# Via script (scan + auto-import)
uv run scripts/recon/scan_and_import.py -t 10.10.13.0/27
```
