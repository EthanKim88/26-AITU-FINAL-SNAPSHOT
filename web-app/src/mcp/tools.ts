import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { apiGet, apiPost, apiPatch, apiDelete } from "./api-client";

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function registerTools(server: McpServer) {
  // ── Situational Awareness ──────────────────────────────────

  server.registerTool("get_sitrep", {
    description: "Get full situational awareness: summary, prioritized next actions (ranked by impact), state snapshot. Call this FIRST at every decision point to decide what to do next.",
    inputSchema: {},
  }, async () => textResult(await apiGet("/api/situational-awareness")));

  // ── Action Queue ──────────────────────────────────────────

  server.registerTool("claim_action", {
    description: "Claim a pending action for your session. Returns 409 if already claimed by another session. This is atomic — safe for concurrent use by multiple Claude instances.",
    inputSchema: {
      actionId: z.string().describe("Action ID from get_sitrep nextActions"),
      sessionId: z.number().describe("Your session ID"),
    },
  }, async ({ actionId, sessionId }) => {
    // Atomic claim — API uses conditional WHERE status='pending' update
    try {
      return textResult(await apiPatch(`/api/actions/${actionId}`, { status: "in_progress", sessionId }));
    } catch (e: unknown) {
      // API returns 409 if already claimed
      const msg = e instanceof Error ? e.message : String(e);
      try {
        const parsed = JSON.parse(msg);
        return textResult({ error: "Action already claimed or not pending", ...parsed, status: 409 });
      } catch {
        return textResult({ error: msg, status: 409 });
      }
    }
  });

  server.registerTool("complete_action", {
    description: "Mark an action as done or failed with a result summary. Always call this when you finish (or give up on) an action.",
    inputSchema: {
      actionId: z.string().describe("Action ID"),
      status: z.string().describe("Outcome: done or failed"),
      result: z.string().optional().describe("What happened — findings, errors, or next steps"),
    },
  }, async ({ actionId, status, result }) => textResult(await apiPatch(`/api/actions/${actionId}`, { status, result })));

  server.registerTool("retry_action", {
    description: "Re-open a done/failed action for retry. Use when conditions changed (new creds, network fixed, etc.).",
    inputSchema: {
      actionId: z.string().describe("Action ID to retry"),
      reason: z.string().optional().describe("Why retrying (e.g. 'got new credentials')"),
    },
  }, async ({ actionId, reason }) => {
    return textResult(await apiPatch(`/api/actions/${actionId}`, {
      status: "pending",
      sessionId: null,
      result: reason ? `Retry: ${reason}` : null,
    }));
  });

  server.registerTool("list_actions", {
    description: "List actions filtered by status. Use to see what's pending, in-progress, or done.",
    inputSchema: {
      status: z.string().optional().describe("Filter: pending, in_progress, done, failed, expired"),
      category: z.string().optional().describe("Filter: recon, exploit, credential, pivot, scada, ad, web, db"),
    },
  }, async ({ status, category }) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    return textResult(await apiGet(`/api/actions?${params.toString()}`));
  });

  // ── Import ────────────────────────────────────────────────

  server.registerTool("import_scan_data", {
    description: "Import scanner JSON output (auto-detects format: full-scan, modbus-scanner, modbus-rw, ad-enum)",
    inputSchema: { data: z.record(z.string(), z.unknown()).describe("Scanner JSON output object") },
  }, async ({ data }) => textResult(await apiPost("/api/import", data)));

  // ── Host ──────────────────────────────────────────────────

  server.registerTool("add_host", {
    description: "Add a new host to the network inventory",
    inputSchema: {
      ip: z.string().describe("IP address"),
      hostname: z.string().optional().describe("Hostname"),
      os: z.string().optional().describe("Operating system"),
      osVersion: z.string().optional().describe("OS version"),
      domain: z.string().optional().describe("Domain name"),
      status: z.string().optional().describe("Host status (up/down)"),
      smbSigning: z.boolean().optional().describe("SMB signing enabled"),
      isDc: z.boolean().optional().describe("Is domain controller"),
      notes: z.string().optional().describe("Notes"),
    },
  }, async (args) => textResult(await apiPost("/api/hosts", args)));

  server.registerTool("update_host", {
    description: "Update an existing host's information",
    inputSchema: {
      hostId: z.string().describe("Host ID"),
      hostname: z.string().optional().describe("Hostname"),
      os: z.string().optional().describe("Operating system"),
      osVersion: z.string().optional().describe("OS version"),
      domain: z.string().optional().describe("Domain name"),
      status: z.string().optional().describe("Host status"),
      smbSigning: z.boolean().optional().describe("SMB signing enabled"),
      isDc: z.boolean().optional().describe("Is domain controller"),
      notes: z.string().optional().describe("Notes"),
    },
  }, async ({ hostId, ...body }) => textResult(await apiPatch(`/api/hosts/${hostId}`, body)));

  server.registerTool("add_host_route", {
    description: "Add or update one host route/network interface record for a host",
    inputSchema: {
      hostId: z.string().optional().describe("Host ID"),
      hostIp: z.string().optional().describe("Host IP (if hostId unknown)"),
      destination: z.string().describe("Route destination CIDR (e.g. 10.1.3.0/24, 0.0.0.0/0)"),
      gateway: z.string().optional().describe("Gateway IP"),
      iface: z.string().optional().describe("Interface name (e.g. eth0)"),
      srcIp: z.string().optional().describe("Source IP for this route"),
      connectedIp: z.string().optional().describe("Interface/connected IP"),
      metric: z.number().optional().describe("Route metric"),
      isDefault: z.boolean().optional().describe("Whether this is the default route"),
      isConnected: z.boolean().optional().describe("Whether this is a directly connected route"),
      source: z.string().optional().describe("How it was discovered"),
      notes: z.string().optional().describe("Notes"),
      raw: z.string().optional().describe("Raw route line text"),
    },
  }, async ({ hostId, hostIp, ...route }) => textResult(await apiPost("/api/host-routes", {
    hostId,
    hostIp,
    routes: [route],
  })));

  server.registerTool("discover_host_routes", {
    description: "Parse host network outputs (ip route/ip addr) and store discovered route/interface IP records",
    inputSchema: {
      hostId: z.string().optional().describe("Host ID"),
      hostIp: z.string().optional().describe("Host IP (if hostId unknown)"),
      ipRouteOutput: z.string().optional().describe("Raw output of `ip route` (or similar route table output)"),
      ipAddrOutput: z.string().optional().describe("Raw output of `ip -o -4 addr` / `ip addr` / `ifconfig`"),
      replace: z.boolean().optional().describe("Replace existing records for this host before saving"),
    },
  }, async (args) => textResult(await apiPost("/api/host-routes/discover", args)));

  server.registerTool("list_host_routes", {
    description: "List saved host route/interface records, optionally filtered by host",
    inputSchema: {
      hostId: z.string().optional().describe("Filter by host ID"),
      hostIp: z.string().optional().describe("Filter by host IP"),
    },
  }, async ({ hostId, hostIp }) => {
    const params = new URLSearchParams();
    if (hostId) params.set("hostId", hostId);
    if (hostIp) params.set("hostIp", hostIp);
    const qs = params.toString();
    return textResult(await apiGet(`/api/host-routes${qs ? `?${qs}` : ""}`));
  });

  // ── Credential ────────────────────────────────────────────

  server.registerTool("add_credential", {
    description: "Register a discovered credential (password, hash, ticket, key)",
    inputSchema: {
      username: z.string().describe("Username"),
      secret: z.string().optional().describe("Password, hash, or key"),
      secretType: z.string().optional().describe("Type: password, ntlm, aes256, ticket, ssh-key"),
      credType: z.string().optional().describe("Credential type: domain, local, service, unknown"),
      domain: z.string().optional().describe("Domain"),
      linkedService: z.string().optional().describe("Associated service"),
      source: z.string().optional().describe("How it was obtained (e.g. kerberoasting, mimikatz)"),
      notes: z.string().optional().describe("Notes"),
      hostId: z.string().optional().describe("Host ID where the credential was found (auto-creates access link)"),
    },
  }, async (args) => textResult(await apiPost("/api/credentials", args)));

  server.registerTool("test_credential_access", {
    description: "Record credential access test result for a host. Uses upsert — safe to call multiple times for the same (cred, host, protocol, port) combination.",
    inputSchema: {
      credId: z.string().describe("Credential ID"),
      hostId: z.string().describe("Target host ID"),
      protocol: z.string().optional().describe("Protocol: smb, winrm, ssh, rdp, mssql, ldap, web, hmi"),
      port: z.number().optional().describe("Target port (e.g. 445, 5985, 22). Omit for host-level access."),
      status: z.string().optional().describe("Result: untested, valid, invalid"),
      isAdmin: z.boolean().optional().describe("Admin access confirmed"),
      notes: z.string().optional().describe("Notes"),
    },
  }, async ({ credId, ...body }) => textResult(await apiPost(`/api/credentials/${credId}/access`, body)));

  server.registerTool("update_access_status", {
    description: "Update a credential access test result",
    inputSchema: {
      credId: z.string().describe("Credential ID"),
      accessId: z.string().describe("Access record ID"),
      status: z.string().optional().describe("Result: untested, valid, invalid"),
      isAdmin: z.boolean().optional().describe("Admin access confirmed"),
      notes: z.string().optional().describe("Notes"),
    },
  }, async ({ credId, accessId, ...body }) => textResult(await apiPatch(`/api/credentials/${credId}/access/${accessId}`, body)));

  // ── Loot ──────────────────────────────────────────────────

  server.registerTool("add_loot", {
    description: "Save extracted loot (source code, DB dumps, config files, etc.) to disk and register metadata. Content is stored as a file under loots/<hostIp>/.",
    inputSchema: {
      filename: z.string().describe("Filename (e.g. 'config.php.bak', 'portal.sql')"),
      content: z.string().describe("File content (text)"),
      hostId: z.string().optional().describe("Host ID where loot was extracted from"),
      hostIp: z.string().optional().describe("Host IP (used to resolve hostId if not provided)"),
      port: z.number().optional().describe("Service port (e.g. 80, 502). When set, file is stored under loots/<ip>/<port>/. Omit for host-level loot."),
      lootType: z.string().optional().describe("Type: db-dump, config, source-code, credential-file, smb-file, ldap-dump, other"),
      source: z.string().optional().describe("Where it was obtained (e.g. URL, file path on target)"),
      notes: z.string().optional().describe("Notes"),
    },
  }, async (args) => textResult(await apiPost("/api/loot", args)));

  server.registerTool("get_loot", {
    description: "Get a loot item's metadata and file content by ID",
    inputSchema: {
      lootId: z.string().describe("Loot ID"),
    },
  }, async ({ lootId }) => textResult(await apiGet(`/api/loot/${lootId}`)));

  server.registerTool("list_loot", {
    description: "List all loot items, optionally filtered by host or type",
    inputSchema: {
      hostId: z.string().optional().describe("Filter by host ID"),
      lootType: z.string().optional().describe("Filter by type: db-dump, config, source-code, etc."),
    },
  }, async ({ hostId, lootType }) => {
    const params = new URLSearchParams();
    if (hostId) params.set("hostId", hostId);
    if (lootType) params.set("lootType", lootType);
    return textResult(await apiGet(`/api/loot?${params.toString()}`));
  });

  // ── Event ─────────────────────────────────────────────────

  server.registerTool("log_event", {
    description: "Log an action or event to the timeline",
    inputSchema: {
      type: z.string().describe("Event type: scan, exploit, credential, note, config"),
      message: z.string().describe("Event description"),
      category: z.string().optional().describe("Category: general, ad, scada, web"),
      source: z.string().optional().describe("Source: ai-agent, manual, import"),
      host: z.string().optional().describe("Related host IP"),
    },
  }, async (args) => textResult(await apiPost("/api/events", args)));

  // ── Note ──────────────────────────────────────────────────

  server.registerTool("add_note", {
    description: "Add an operator note",
    inputSchema: {
      content: z.string().describe("Note content (markdown supported)"),
      tags: z.string().optional().describe("Comma-separated tags"),
      host: z.string().optional().describe("Related host IP"),
    },
  }, async (args) => textResult(await apiPost("/api/notes", args)));

  // ── Checklist ─────────────────────────────────────────────

  server.registerTool("create_checklist", {
    description: "Create an attack checklist for a host",
    inputSchema: {
      hostId: z.string().optional().describe("Host ID"),
      hostIp: z.string().optional().describe("Host IP (if no ID)"),
      sessionId: z.number().optional().describe("Claiming session ID"),
      notes: z.string().optional().describe("Initial notes"),
    },
  }, async (args) => textResult(await apiPost("/api/checklists", args)));

  server.registerTool("update_checklist", {
    description: "Update attack checklist phase status. Timestamps are auto-set: in-progress sets startedAt, done/skipped sets completedAt.",
    inputSchema: {
      checklistId: z.string().describe("Checklist ID"),
      enumStatus: z.string().optional().describe("pending | in-progress | done | skipped"),
      exploitStatus: z.string().optional().describe("pending | in-progress | done | skipped"),
      privescStatus: z.string().optional().describe("pending | in-progress | done | skipped"),
      sessionId: z.number().optional().describe("Session ID claiming this host"),
      notes: z.string().optional().describe("Progress notes"),
    },
  }, async ({ checklistId, ...body }) => textResult(await apiPatch(`/api/checklists/${checklistId}`, body)));

  server.registerTool("claim_host", {
    description: "Claim a host for your session and start enumeration. Creates checklist if none exists. Returns 409 if another session already claimed it.",
    inputSchema: {
      hostId: z.string().describe("Host ID to claim"),
      sessionId: z.number().describe("Your session ID"),
      notes: z.string().optional().describe("Initial notes"),
    },
  }, async (args) => textResult(await apiPost("/api/checklists/claim", args)));

  // ── Segment ───────────────────────────────────────────────

  server.registerTool("add_segment", {
    description: "Add a network segment. Default scope is global. For host-local segments, set ownerHostId.",
    inputSchema: {
      name: z.string().describe("Segment name"),
      cidr: z.string().optional().describe("CIDR notation (e.g. 10.10.10.0/24)"),
      description: z.string().optional().describe("Segment description"),
      scope: z.string().optional().describe("Segment scope: global | host-local"),
      ownerHostId: z.string().optional().describe("Owner host ID (required when scope=host-local)"),
    },
  }, async (args) => textResult(await apiPost("/api/segments", args)));

  // ── Pivot Routes ─────────────────────────────────────────────

  server.registerTool("add_pivot_route", {
    description: "Register a network pivot route (how to reach one segment from another through a host)",
    inputSchema: {
      fromSegmentId: z.string().describe("Source segment ID (where you pivot FROM)"),
      toSegmentId: z.string().describe("Target segment ID (where you pivot TO)"),
      pivotHostId: z.string().describe("Host ID of the dual-homed pivot machine"),
      credentialId: z.string().optional().describe("Credential ID for authentication on the pivot host"),
      protocol: z.string().optional().describe("Tunnel protocol: ssh, winrm, chisel, ligolo, socks"),
      port: z.number().optional().describe("Port on the pivot host (default: 22)"),
      status: z.string().optional().describe("Route status: active, inactive, untested"),
      notes: z.string().optional().describe("Notes"),
    },
  }, async (args) => textResult(await apiPost("/api/pivot-routes", args)));

  server.registerTool("get_pivot_chain", {
    description: "Compute the full pivot chain to reach a target segment, with auto-generated tunnel commands (ligolo-ng primary, chisel/SSH fallback)",
    inputSchema: {
      target: z.string().describe("Target segment ID or name"),
    },
  }, async ({ target }) => textResult(await apiGet(`/api/pivot-routes/chain?target=${encodeURIComponent(target)}`)));

  server.registerTool("update_segment_reachability", {
    description: "Mark whether a network segment is directly reachable from the attacker's machine (no pivot needed)",
    inputSchema: {
      segmentId: z.string().describe("Segment ID"),
      reachable: z.boolean().describe("true if directly reachable, false if requires pivoting"),
    },
  }, async ({ segmentId, reachable }) => textResult(await apiPatch(`/api/segments/${segmentId}`, { reachable })));

  server.registerTool("update_pivot_route", {
    description: "Update an existing pivot route (e.g. change status, credential, protocol)",
    inputSchema: {
      routeId: z.string().describe("Pivot route ID"),
      protocol: z.string().optional().describe("Tunnel protocol"),
      port: z.number().optional().describe("Port"),
      status: z.string().optional().describe("Status: active, inactive, untested"),
      credentialId: z.string().optional().describe("Credential ID"),
      notes: z.string().optional().describe("Notes"),
    },
  }, async ({ routeId, ...body }) => textResult(await apiPatch(`/api/pivot-routes/${routeId}`, body)));

  server.registerTool("delete_pivot_route", {
    description: "Delete a pivot route",
    inputSchema: {
      routeId: z.string().describe("Pivot route ID"),
    },
  }, async ({ routeId }) => textResult(await apiDelete(`/api/pivot-routes/${routeId}`)));

  // ── Session ────────────────────────────────────────────────

  server.registerTool("start_session", {
    description: "Start a new AI work session to track progress",
    inputSchema: {
      title: z.string().describe("Session title (e.g. 'AD domain takeover')"),
      goal: z.string().optional().describe("Session goal"),
    },
  }, async (args) => textResult(await apiPost("/api/sessions", args)));

  server.registerTool("resume_session", {
    description: "Resume a session — returns recent entries + pending tasks (compact for context window)",
    inputSchema: {
      sessionId: z.number().describe("Session ID (integer)"),
    },
  }, async ({ sessionId }) => textResult(await apiGet(`/api/sessions/${sessionId}?brief=true`)));

  server.registerTool("log_session_entry", {
    description: "Log a step/action/analysis to the current session",
    inputSchema: {
      sessionId: z.number().describe("Session ID"),
      type: z.string().describe("Entry type: action, analysis, request, result, decision, note"),
      content: z.string().describe("Description of what was done or decided"),
      data: z.string().optional().describe("Optional JSON data payload"),
    },
  }, async ({ sessionId, ...body }) => textResult(await apiPost(`/api/sessions/${sessionId}/entries`, body)));

  server.registerTool("heartbeat", {
    description: "Send a heartbeat for your session to signal you're still alive. Call this at least once per OODA loop iteration. Sessions without heartbeat for 5+ minutes are marked stale, and their claimed actions/hosts are released.",
    inputSchema: {
      sessionId: z.number().describe("Your session ID"),
    },
  }, async ({ sessionId }) => textResult(await apiPatch(`/api/sessions/${sessionId}`, { heartbeat: true })));

  server.registerTool("pause_session", {
    description: "Pause a session (waiting for human task completion, can resume later)",
    inputSchema: {
      sessionId: z.number().describe("Session ID"),
    },
  }, async ({ sessionId }) => textResult(await apiPatch(`/api/sessions/${sessionId}`, { status: "paused" })));

  server.registerTool("complete_session", {
    description: "Mark a session as completed with a summary",
    inputSchema: {
      sessionId: z.number().describe("Session ID"),
      summary: z.string().describe("Summary of what was accomplished"),
    },
  }, async ({ sessionId, summary }) => textResult(await apiPatch(`/api/sessions/${sessionId}`, { status: "completed", summary })));

  server.registerTool("list_sessions", {
    description: "List all AI sessions with task counts",
    inputSchema: {},
  }, async () => textResult(await apiGet("/api/sessions")));

  // ── Task ───────────────────────────────────────────────────

  server.registerTool("request_task", {
    description: "Request the human operator to perform a task (scan, crack, exploit, etc.)",
    inputSchema: {
      type: z.string().describe("Task type: scan, crack, exploit, spray, collect, manual"),
      title: z.string().describe("Task title"),
      priority: z.string().optional().describe("Priority: critical, high, medium, low"),
      command: z.string().optional().describe("Suggested command to run (copy-paste ready)"),
      context: z.string().optional().describe("Why this task is needed"),
      expectedOutput: z.string().optional().describe("What output format to expect"),
      hostIp: z.string().optional().describe("Target host IP"),
      sessionId: z.number().optional().describe("Associated session ID"),
    },
  }, async (args) => textResult(await apiPost("/api/tasks", args)));

  server.registerTool("complete_task", {
    description: "Mark a task as done and optionally record the result",
    inputSchema: {
      taskId: z.string().describe("Task ID"),
      result: z.string().optional().describe("Task result/output"),
    },
  }, async ({ taskId, result }) => textResult(await apiPatch(`/api/tasks/${taskId}`, { status: "done", ...(result ? { result } : {}) })));

  server.registerTool("list_pending_tasks", {
    description: "List all pending task requests for the human operator",
    inputSchema: {},
  }, async () => textResult(await apiGet("/api/tasks?status=pending")));
}
