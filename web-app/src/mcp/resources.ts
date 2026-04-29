import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp";
import { apiGet } from "./api-client";

function jsonContents(uri: string, data: unknown) {
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
}

export function registerResources(server: McpServer) {
  // ── Static Resources ──────────────────────────────────────

  server.registerResource("context", "ctf://context", {
    description: "CTF engagement summary: hosts, credentials, AD, SCADA stats",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/context")));

  server.registerResource("attack-surface", "ctf://attack-surface", {
    description: "Attack surface analysis: unexplored hosts, SMB signing, roastable users, recommendations",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/attack-surface")));

  server.registerResource("sitrep", "ctf://sitrep", {
    description: "Situational awareness: summary + prioritized next actions + state snapshot. READ THIS FIRST every loop iteration.",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/situational-awareness")));

  server.registerResource("dashboard", "ctf://dashboard", {
    description: "Battle map dashboard data: segment stats and credential summary",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/dashboard")));

  server.registerResource("hosts", "ctf://hosts", {
    description: "All hosts with ports, segments, route/interface IP records, credential accesses",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/hosts")));

  server.registerResource("host-routes", "ctf://host-routes", {
    description: "All host route/interface IP records (destination, gateway, iface, connected IP)",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/host-routes")));

  server.registerResource("credentials", "ctf://credentials", {
    description: "All credentials with access matrix (host, protocol, status, isAdmin)",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/credentials")));

  server.registerResource("notes", "ctf://notes", {
    description: "Operator notes with tags and host associations",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/notes")));

  server.registerResource("checklists", "ctf://checklists", {
    description: "Per-host attack checklists (enumerated, exploited, privesc)",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/checklists")));

  server.registerResource("ad-domains", "ctf://ad", {
    description: "Active Directory domains with user/group/computer/trust/GPO counts",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/ad")));

  server.registerResource("scada-devices", "ctf://scada", {
    description: "SCADA/Modbus devices with register counts",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/scada")));

  server.registerResource("loot", "ctf://loot", {
    description: "All loot items (extracted files, DB dumps, configs) with host associations",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/loot")));

  server.registerResource("timeline", "ctf://timeline", {
    description: "Recent events timeline (scans, exploits, imports)",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/events")));

  server.registerResource("sessions", "ctf://sessions", {
    description: "All AI work sessions with task counts and status",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/sessions")));

  server.registerResource("tasks", "ctf://tasks", {
    description: "All task requests for the human operator",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/tasks")));

  server.registerResource("pending-tasks", "ctf://tasks/pending", {
    description: "Pending task requests awaiting operator action",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/tasks?status=pending")));

  server.registerResource("pivot-routes", "ctf://pivot-routes", {
    description: "All pivot routes between network segments with host, credential, and protocol details",
  }, async (uri) => jsonContents(uri.href, await apiGet("/api/pivot-routes")));

  // ── Dynamic Resources (Templates) ─────────────────────────

  server.registerResource("host-detail", new ResourceTemplate("ctf://hosts/{hostId}", {
    list: undefined,
  }), {
    description: "Detailed host info: ports, routes, credential accesses, checklists",
  }, async (uri, { hostId }) => {
    const data = await apiGet(`/api/hosts/${hostId}`);
    return jsonContents(uri.href, data);
  });

  server.registerResource("host-routes-detail", new ResourceTemplate("ctf://host-routes/{hostId}", {
    list: undefined,
  }), {
    description: "Route/interface IP records for a specific host",
  }, async (uri, { hostId }) => {
    const data = await apiGet(`/api/host-routes?hostId=${encodeURIComponent(hostId as string)}`);
    return jsonContents(uri.href, data);
  });

  server.registerResource("ad-domain-detail", new ResourceTemplate("ctf://ad/{domainId}", {
    list: undefined,
  }), {
    description: "AD domain detail: users, groups, computers, trusts, GPOs, attack recommendations",
  }, async (uri, { domainId }) => {
    const data = await apiGet(`/api/ad/${domainId}`);
    return jsonContents(uri.href, data);
  });

  server.registerResource("scada-device-detail", new ResourceTemplate("ctf://scada/{deviceId}", {
    list: undefined,
  }), {
    description: "SCADA device registers: type, address, raw/hex/decoded values",
  }, async (uri, { deviceId }) => {
    const data = await apiGet(`/api/scada/${deviceId}`);
    return jsonContents(uri.href, data);
  });

  server.registerResource("session-detail", new ResourceTemplate("ctf://sessions/{sessionId}", {
    list: undefined,
  }), {
    description: "Session detail with entry timeline and associated tasks",
  }, async (uri, { sessionId }) => {
    const data = await apiGet(`/api/sessions/${sessionId}`);
    return jsonContents(uri.href, data);
  });

  server.registerResource("loot-detail", new ResourceTemplate("ctf://loot/{lootId}", {
    list: undefined,
  }), {
    description: "Loot item detail with file content",
  }, async (uri, { lootId }) => {
    const data = await apiGet(`/api/loot/${lootId}`);
    return jsonContents(uri.href, data);
  });

  server.registerResource("pivot-chain", new ResourceTemplate("ctf://pivot-chain/{segmentName}", {
    list: undefined,
  }), {
    description: "Computed pivot chain to reach a target segment, including hop details and tunnel commands",
  }, async (uri, { segmentName }) => {
    const data = await apiGet(`/api/pivot-routes/chain?target=${encodeURIComponent(segmentName as string)}`);
    return jsonContents(uri.href, data);
  });
}
