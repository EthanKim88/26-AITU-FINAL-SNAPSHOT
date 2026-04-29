import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api";

/**
 * GET /api/situational-awareness
 *
 * Single-call situational awareness for autonomous Claude agents.
 * Combines context + attack-surface + recommendations into one response
 * with explicit "next actions" ranked by expected impact.
 */
export async function GET() {
  try {
    const [
      segments,
      hosts,
      credentials,
      adDomains,
      scadaDevices,
      sessions,
      pendingTasks,
      recentEvents,
      pivotRoutes,
    ] = await Promise.all([
      prisma.networkSegment.findMany({
        orderBy: [{ scope: "asc" }, { order: "asc" }, { name: "asc" }],
        include: {
          ownerHost: { select: { id: true, ip: true, hostname: true } },
          hostLinks: { include: { host: { select: { id: true, ip: true } } } },
        },
      }),
      prisma.host.findMany({
        include: {
          ports: { orderBy: { port: "asc" } },
          accesses: { include: { credential: { select: { id: true, username: true, domain: true, secretType: true } } } },
          checklists: { include: { session: { select: { id: true, title: true, status: true } } } },
          segments: {
            include: {
              segment: {
                select: {
                  id: true,
                  name: true,
                  scope: true,
                  ownerHost: { select: { id: true, ip: true, hostname: true } },
                },
              },
            },
          },
          routes: { orderBy: [{ isDefault: "desc" }, { destination: "asc" }, { iface: "asc" }] },
        },
      }),
      prisma.credential.findMany({
        include: { accesses: { include: { host: { select: { id: true, ip: true } } } } },
      }),
      prisma.adDomain.findMany({
        include: { users: true, groups: true, computers: true, trusts: true, gpos: true },
      }),
      prisma.scadaDevice.findMany({ include: { registers: true } }),
      prisma.aiSession.findMany({
        where: { status: "active" },
        include: { _count: { select: { entries: true, tasks: true } } },
      }),
      prisma.taskRequest.findMany({ where: { status: "pending" } }),
      prisma.event.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.pivotRoute.findMany({
        include: {
          fromSegment: { select: { id: true, name: true } },
          toSegment: { select: { id: true, name: true } },
          pivotHost: { select: { id: true, ip: true } },
        },
      }),
    ]);

    // ── Stale session detection & auto-release ────────────────
    // Sessions with no heartbeat for 5+ minutes are marked stale.
    // Their claimed actions are released back to pending.
    const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    const now = new Date();
    const staleSessions = sessions.filter(
      (s) => now.getTime() - new Date(s.lastHeartbeat).getTime() > STALE_THRESHOLD_MS
    );
    if (staleSessions.length > 0) {
      const staleIds = staleSessions.map((s) => s.id);
      // Mark sessions as stale
      await prisma.aiSession.updateMany({
        where: { id: { in: staleIds }, status: "active" },
        data: { status: "stale" },
      });
      // Release their claimed actions back to pending
      await prisma.actionItem.updateMany({
        where: { sessionId: { in: staleIds }, status: "in_progress" },
        data: { status: "pending", sessionId: null, claimedAt: null },
      });
      // Remove stale sessions from the active list for the rest of this response
      for (const id of staleIds) {
        const idx = sessions.findIndex((s) => s.id === id);
        if (idx !== -1) sessions.splice(idx, 1);
      }
    }

    // ── Derived analysis ──────────────────────────────────────

    const reachableSegmentIds = new Set(
      segments.filter((s) => s.reachable).map((s) => s.id)
    );
    const globalSegments = segments.filter((s) => s.scope === "global");
    // Add segments reachable via active pivots
    for (const pr of pivotRoutes) {
      if (pr.status === "active" && reachableSegmentIds.has(pr.fromSegmentId)) {
        reachableSegmentIds.add(pr.toSegmentId);
      }
    }

    const STATUS_KEYS = ["enumStatus", "exploitStatus", "privescStatus"] as const;

    // Categorize hosts
    const unclaimed = hosts.filter((h) => h.checklists.length === 0);
    const claimed = hosts.filter((h) => h.checklists.length > 0);
    const stalled = claimed.filter((h) => {
      const cl = h.checklists[0];
      if (!cl) return false;
      const hasInProgress = STATUS_KEYS.some((k) => cl[k] === "in-progress");
      if (!hasInProgress) return false;
      // Check if session is still active
      return cl.session?.status !== "active";
    });

    // Credential coverage analysis (host:port level)
    const CRED_RELEVANT_PORTS: Record<string, number[]> = {
      domain: [445, 5985, 389, 636, 88, 135, 3389],
      local: [445, 5985, 22, 3389],
      service: [1433, 3306, 5432, 80, 443, 8080, 502],
      webapp: [80, 443, 8080, 8443],
      unknown: [445, 22, 5985, 80],
    };

    const credCoverage = credentials.map((c) => {
      // Track tested (host:port) keys
      const testedKeys = new Set(
        c.accesses.map((a) => `${a.hostId}:${a.port ?? a.protocol}`)
      );
      const testedHostIds = new Set(c.accesses.map((a) => a.hostId));
      const validHostIds = c.accesses.filter((a) => a.status === "valid").map((a) => a.hostId);
      const adminHostIds = c.accesses.filter((a) => a.status === "valid" && a.isAdmin).map((a) => a.hostId);

      // Count untested host:port targets
      const relevantPorts = CRED_RELEVANT_PORTS[c.credType] ?? CRED_RELEVANT_PORTS.unknown;
      const untestedTargets: { hostId: string; ip: string; port: number; service: string }[] = [];
      for (const h of hosts) {
        for (const p of h.ports) {
          if (p.state !== "open" || !relevantPorts.includes(p.port)) continue;
          if (!testedKeys.has(`${h.id}:${p.port}`)) {
            untestedTargets.push({ hostId: h.id, ip: h.ip, port: p.port, service: p.service });
          }
        }
      }

      return {
        id: c.id,
        username: c.username,
        domain: c.domain,
        credType: c.credType,
        secretType: c.secretType,
        testedOn: testedHostIds.size,
        totalHosts: hosts.length,
        untestedCount: untestedTargets.length,
        untestedTargets,
        validCount: new Set(validHostIds).size,
        adminCount: new Set(adminHostIds).size,
      };
    });

    // AD quick-wins
    const kerberoastable = adDomains.flatMap((d) =>
      d.users.filter((u) => u.kerberoastable).map((u) => ({ domain: d.domainName, username: u.username, spn: u.spn }))
    );
    const asrepRoastable = adDomains.flatMap((d) =>
      d.users.filter((u) => u.asrepRoastable).map((u) => ({ domain: d.domainName, username: u.username }))
    );
    const delegationTargets = adDomains.flatMap((d) =>
      d.users.filter((u) => u.constrainedDelegationTargets).map((u) => ({
        domain: d.domainName, username: u.username, targets: u.constrainedDelegationTargets,
      }))
    );

    // ── Generate prioritized next actions ─────────────────────
    //
    // DESIGN: Actions contain CONTEXT (what is known) not PLAYBOOKS (what to do).
    // The AI agent decides HOW to act based on the context. This preserves autonomy.
    //
    // Each action is generated based on data-driven triggers:
    //   Tier 1 (high):     Stalled hosts — session died mid-work → resume
    //   Tier 2 (high):     Valid creds with untested hosts → credential spray
    //   Tier 3 (high):     Kerberoastable / ASREPRoastable AD users → hash extraction
    //   Tier 4 (high/med): Unclaimed hosts with interesting ports → enumerate
    //   Tier 5 (high):     Unreachable segments with untested pivots → activate tunnel
    //   Tier 6 (medium):   Constrained delegation targets → privilege escalation
    //   Tier 7 (medium):   SMB signing disabled → relay opportunity

    // ── Port classification (no commands, just labels + categories) ──

    const portInfo: Record<number, { label: string; category: string }> = {
      21: { label: "FTP", category: "recon" },
      22: { label: "SSH", category: "recon" },
      80: { label: "HTTP", category: "web" },
      443: { label: "HTTPS", category: "web" },
      8080: { label: "HTTP-Alt", category: "web" },
      8443: { label: "HTTPS-Alt", category: "web" },
      88: { label: "Kerberos", category: "ad" },
      135: { label: "RPC", category: "ad" },
      389: { label: "LDAP", category: "ad" },
      445: { label: "SMB", category: "ad" },
      636: { label: "LDAPS/ADCS", category: "ad" },
      3389: { label: "RDP", category: "ad" },
      5985: { label: "WinRM", category: "ad" },
      1433: { label: "MSSQL", category: "db" },
      3306: { label: "MySQL", category: "db" },
      502: { label: "Modbus", category: "scada" },
      102: { label: "S7comm", category: "scada" },
      44818: { label: "EtherNet/IP", category: "scada" },
      161: { label: "SNMP", category: "recon" },
    };

    // Build context about what credentials are available for a host
    type CredContext = {
      username: string;
      domain?: string;
      secretType?: string;
      isAdmin: boolean;
      protocols: string[];
    };
    function getCredsForHost(hostId: string): CredContext[] {
      const result: CredContext[] = [];
      for (const c of credentials) {
        const validAccesses = c.accesses.filter((a) => a.hostId === hostId && a.status === "valid");
        if (validAccesses.length > 0) {
          result.push({
            username: c.username,
            domain: c.domain || undefined,
            secretType: c.secretType || undefined,
            isAdmin: validAccesses.some((a) => a.isAdmin),
            protocols: validAccesses.map((a) => a.protocol),
          });
        }
      }
      // Also include untested domain creds as "available" (not yet tested on this host)
      const testedCredIds = new Set(
        credentials.flatMap((c) => c.accesses.filter((a) => a.hostId === hostId).map(() => c.id))
      );
      for (const c of credentials) {
        if (!testedCredIds.has(c.id) && c.credType === "domain" && c.secret) {
          result.push({
            username: c.username,
            domain: c.domain || undefined,
            secretType: c.secretType || undefined,
            isAdmin: false,
            protocols: [], // empty = untested
          });
        }
      }
      return result;
    }

    // Build context about a host for action context
    function buildHostContext(h: typeof hosts[number]) {
      const openPorts = h.ports.map((p) => ({
        port: p.port,
        protocol: p.protocol,
        service: p.service || portInfo[p.port]?.label || "unknown",
        version: p.version || undefined,
        banner: p.banner || undefined,
      }));
      const hostCreds = getCredsForHost(h.id);
      const hostSegments = h.segments.map((s) => {
        if (s.segment.scope !== "host-local") return s.segment.name;
        const ownerIp = s.segment.ownerHost?.ip || "unknown-host";
        return `${s.segment.name} [host-local@${ownerIp}]`;
      });
      const hostRoutes = h.routes.map((route) => ({
        destination: route.destination,
        gateway: route.gateway || undefined,
        iface: route.iface || undefined,
        srcIp: route.srcIp || undefined,
        connectedIp: route.connectedIp || undefined,
        isDefault: route.isDefault,
      }));
      const checklist = h.checklists[0];

      return {
        ip: h.ip,
        hostname: h.hostname || undefined,
        os: h.os || undefined,
        domain: h.domain || undefined,
        isDc: h.isDc || undefined,
        smbSigning: h.smbSigning,
        segments: hostSegments.length > 0 ? hostSegments : undefined,
        connectedIps: [...new Set(h.routes
          .map((route) => route.connectedIp || route.srcIp)
          .filter((ip) => ip.length > 0))],
        routes: hostRoutes.length > 0 ? hostRoutes : undefined,
        openPorts,
        credentials: hostCreds.length > 0 ? hostCreds : undefined,
        checklistStatus: checklist ? {
          enum: checklist.enumStatus,
          exploit: checklist.exploitStatus,
          privesc: checklist.privescStatus,
          sessionId: checklist.sessionId,
        } : undefined,
        notes: h.notes || undefined,
      };
    }

    // Action type — context replaces playbook
    type ActionContext = Record<string, unknown>;
    type Action = {
      priority: "critical" | "high" | "medium" | "low";
      action: string;
      reason: string;
      category: "recon" | "exploit" | "credential" | "pivot" | "scada" | "ad" | "web" | "db";
      target?: string;
      context?: ActionContext;
    };

    const actions: Action[] = [];

    // 1. Stalled hosts (session died mid-work)
    for (const h of stalled) {
      actions.push({
        priority: "high",
        action: `Resume stalled work on ${h.ip}`,
        reason: `Host was in-progress but session is no longer active`,
        category: "exploit",
        target: h.ip,
        context: { host: buildHostContext(h) },
      });
    }

    // 2. New credentials → spray on untested host:port targets
    const highValueCreds = credCoverage
      .filter((c) => c.validCount > 0 && c.untestedCount > 0)
      .sort((a, b) => b.adminCount - a.adminCount || b.untestedCount - a.untestedCount);

    for (const c of highValueCreds.slice(0, 3)) {
      const userStr = `${c.username}${c.domain ? `@${c.domain}` : ""}`;
      const targets = c.untestedTargets.slice(0, 20).map(({ ip, port, service }) => ({ ip, port, service }));

      actions.push({
        priority: "high",
        action: `Spray credential ${userStr} on ${c.untestedCount} untested services`,
        reason: `Valid on ${c.validCount} hosts (${c.adminCount} admin), ${c.untestedCount} host:port targets untested`,
        category: "credential",
        context: {
          credential: { username: c.username, domain: c.domain, secretType: c.secretType },
          targets,
          validOnHosts: c.validCount,
          adminOnHosts: c.adminCount,
          totalUntested: c.untestedCount,
        },
      });
    }

    // 3. Kerberoast / ASREPRoast
    for (const u of kerberoastable) {
      const domainCred = credentials.find((c) => c.credType === "domain" && c.domain === u.domain && c.secret);
      const dcIp = adDomains.find((d) => d.domainName === u.domain)?.dcIp;
      actions.push({
        priority: "high",
        action: `Kerberoast ${u.domain}/${u.username}`,
        reason: `SPN: ${u.spn || "detected"}`,
        category: "ad",
        context: {
          attackType: "kerberoast",
          targetUser: u.username,
          domain: u.domain,
          spn: u.spn,
          dcIp,
          hasValidDomainCred: !!domainCred,
          domainCred: domainCred ? { username: domainCred.username, domain: domainCred.domain } : undefined,
        },
      });
    }
    for (const u of asrepRoastable) {
      const dcIp = adDomains.find((d) => d.domainName === u.domain)?.dcIp;
      actions.push({
        priority: "high",
        action: `ASREPRoast ${u.domain}/${u.username}`,
        reason: "No Kerberos pre-auth required",
        category: "ad",
        context: {
          attackType: "asreproast",
          targetUser: u.username,
          domain: u.domain,
          dcIp,
          // ASREPRoast doesn't need domain creds — no pre-auth
        },
      });
    }

    // 4. Unclaimed hosts → generate context-rich actions per service category
    for (const h of unclaimed) {
      const openPorts = h.ports.map((p) => p.port);
      const knownPorts = openPorts.filter((p) => p in portInfo);
      if (knownPorts.length === 0 && openPorts.length === 0) continue;

      // Group ports by category
      const catPriority: Record<string, number> = { scada: 0, ad: 1, web: 2, db: 3, recon: 4 };
      const portsByCategory: Record<string, number[]> = {};
      for (const p of knownPorts) {
        const cat = portInfo[p]!.category;
        if (!portsByCategory[cat]) portsByCategory[cat] = [];
        portsByCategory[cat]!.push(p);
      }

      // Sort categories by attack priority
      const sortedCats = Object.entries(portsByCategory)
        .sort(([a], [b]) => (catPriority[a] ?? 9) - (catPriority[b] ?? 9));

      // One action per category (most valuable first), max 2 per host
      const hostCtx = buildHostContext(h);
      for (const [cat, ports] of sortedCats.slice(0, 2)) {
        const services = ports.map((p) => portInfo[p]?.label || `port-${p}`);

        actions.push({
          priority: knownPorts.length >= 3 ? "high" : "medium",
          action: `Enumerate ${services.join("/")} on ${h.ip}`,
          reason: `Unclaimed host — ${openPorts.length} open ports [${services.join(", ")}]`,
          category: cat as Action["category"],
          target: h.ip,
          context: {
            host: hostCtx,
            targetPorts: ports.map((p) => ({
              port: p,
              service: portInfo[p]?.label,
              version: h.ports.find((hp) => hp.port === p)?.version || undefined,
              banner: h.ports.find((hp) => hp.port === p)?.banner || undefined,
            })),
          },
        });
      }
    }

    // 5. Unreachable segments with known pivot paths
    const unreachableWithPivot = globalSegments.filter((s) =>
      !reachableSegmentIds.has(s.id) &&
      pivotRoutes.some((pr) => pr.toSegmentId === s.id && pr.status === "untested")
    );
    for (const s of unreachableWithPivot) {
      const routes = pivotRoutes.filter((pr) => pr.toSegmentId === s.id && pr.status === "untested");
      // Find credentials available on the pivot host for tunneling context
      const pivotHostIds = routes.map((r) => r.pivotHostId);
      const pivotCreds = pivotHostIds.flatMap((hid) => getCredsForHost(hid));
      const hasSshAccess = routes.some((r) => r.protocol === "ssh" || r.port === 22);

      actions.push({
        priority: "high",
        action: `Activate pivot to reach ${s.name} (${s.cidr || "unknown CIDR"})`,
        reason: "Untested pivot route exists",
        category: "pivot",
        context: {
          targetSegment: { id: s.id, name: s.name, cidr: s.cidr },
          pivotRoutes: routes.map((r) => ({
            id: r.id,
            fromSegment: r.fromSegment.name,
            pivotHost: r.pivotHost.ip,
            protocol: r.protocol,
            port: r.port,
          })),
          tunneling: {
            recommended: hasSshAccess ? "ligolo-ng" : "chisel",
            fallback: hasSshAccess ? ["chisel", "ssh-dynamic"] : ["ssh-dynamic", "ssh-local"],
            pivotCredentials: pivotCreds.length > 0 ? pivotCreds : undefined,
            note: hasSshAccess
              ? "Upload ligolo-agent via scp, connect back to proxy on :11601. Fallback: chisel socks or ssh -D."
              : "No SSH — try chisel reverse via webshell or request_task for manual tunnel.",
          },
        },
      });
    }

    // 6. Constrained delegation
    for (const u of delegationTargets) {
      actions.push({
        priority: "medium",
        action: `Exploit constrained delegation: ${u.username} → ${u.targets}`,
        reason: "Delegation target may yield higher-privilege access",
        category: "ad",
        context: {
          attackType: "constrained-delegation",
          username: u.username,
          domain: u.domain,
          delegationTargets: u.targets,
        },
      });
    }

    // 7. SMB signing disabled
    const smbNoSign = hosts.filter((h) => h.smbSigning === false);
    if (smbNoSign.length > 0) {
      actions.push({
        priority: "medium",
        action: `NTLM relay on ${smbNoSign.map((h) => h.ip).join(", ")}`,
        reason: `${smbNoSign.length} hosts with SMB signing disabled`,
        category: "exploit",
        context: {
          attackType: "ntlm-relay",
          vulnerableHosts: smbNoSign.map((h) => h.ip),
          hostCount: smbNoSign.length,
        },
      });
    }

    // Sort by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // ── Persist new actions to DB (dedup via fingerprint) ────

    function fingerprint(a: Action): string {
      // category + target + action + whether creds are available
      // This way "SMB enum on 10.1.3.10 (no creds)" and "SMB enum on 10.1.3.10 (with creds)"
      // are DIFFERENT actions, so getting new creds triggers a new attempt.
      const ctx = a.context || {};
      const hasCreds = !!(
        (ctx.credentials && (ctx.credentials as unknown[]).length > 0) ||
        (ctx.hasValidDomainCred) ||
        (ctx.host && (ctx.host as Record<string, unknown>).credentials)
      );
      return `${a.category}:${a.target || ""}:${a.action.slice(0, 80)}:${hasCreds ? "auth" : "noauth"}`;
    }

    // Expire stale actions: if an action is pending but no longer in the generated list,
    // mark it expired (the situation changed — e.g., host was claimed by someone else)
    const newFingerprints = new Set(actions.map(fingerprint));
    const existingActions = await prisma.actionItem.findMany({
      where: { status: { in: ["pending"] } },
    });
    const toExpire = existingActions.filter((ea) => !newFingerprints.has(ea.fingerprint));
    if (toExpire.length > 0) {
      await prisma.actionItem.updateMany({
        where: { id: { in: toExpire.map((a) => a.id) } },
        data: { status: "expired", completedAt: new Date() },
      });
    }

    // ── Enrich actions with prior attempt history ─────────────
    // Fetch all done/failed actions to inject priorAttempts into context.
    // This lets agents see what was already tried and why it failed.
    const completedActions = await prisma.actionItem.findMany({
      where: { status: { in: ["done", "failed"] } },
      select: { action: true, category: true, target: true, status: true, result: true, completedAt: true },
      orderBy: { completedAt: "desc" },
    });
    // Index by target for fast lookup
    const priorByTarget: Record<string, typeof completedActions> = {};
    for (const ca of completedActions) {
      const key = ca.target || "__global__";
      if (!priorByTarget[key]) priorByTarget[key] = [];
      priorByTarget[key]!.push(ca);
    }

    // Inject priorAttempts into each action's context
    for (const a of actions) {
      const targetPriors = priorByTarget[a.target || "__global__"];
      if (targetPriors && targetPriors.length > 0) {
        // Only include relevant priors (same category or same target), max 5
        const relevant = targetPriors
          .filter((p) => p.category === a.category || p.target === a.target)
          .slice(0, 5);
        if (relevant.length > 0) {
          if (!a.context) a.context = {};
          a.context.priorAttempts = relevant.map((p) => ({
            action: p.action,
            status: p.status,
            result: p.result,
            completedAt: p.completedAt,
          }));
        }
      }
    }

    // Upsert new actions
    for (const a of actions) {
      const fp = fingerprint(a);
      const existing = await prisma.actionItem.findUnique({ where: { fingerprint: fp } });

      if (!existing) {
        // Brand new action
        await prisma.actionItem.create({
          data: {
            fingerprint: fp,
            priority: a.priority,
            action: a.action,
            reason: a.reason,
            category: a.category,
            target: a.target,
            context: JSON.stringify(a.context || {}),
            status: "pending",
          },
        });
      } else if (existing.status === "pending") {
        // Still pending — update context/priority if changed (creds may have been found)
        await prisma.actionItem.update({
          where: { id: existing.id },
          data: {
            priority: a.priority,
            reason: a.reason,
            context: JSON.stringify(a.context || {}),
          },
        });
      } else if (existing.status === "in_progress") {
        // Someone is working on it — don't touch
      } else if (existing.status === "failed" || existing.status === "expired") {
        // Failed or expired but the system still thinks it's worth doing
        // → re-open as pending (retry). Playbook may have changed (new creds, etc.)
        await prisma.actionItem.update({
          where: { id: existing.id },
          data: {
            priority: a.priority,
            reason: a.reason,
            context: JSON.stringify(a.context || {}),
            status: "pending",
            sessionId: null,
            result: null,
            claimedAt: null,
            completedAt: null,
          },
        });
      }
      // status === "done" → situation still generates it, but we already did it.
      // Don't re-open. If the situation truly changed (e.g. new creds),
      // the context/action text will differ → different fingerprint → new action.
    }

    // Fetch all active actions from DB for the response
    const dbActions = await prisma.actionItem.findMany({
      where: { status: { in: ["pending", "in_progress"] } },
      include: { session: { select: { id: true, title: true } } },
      orderBy: { createdAt: "asc" },
    });

    // Sort: pending first, then by priority
    dbActions.sort((a, b) => {
      if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
      return (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 9) -
             (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 9);
    });

    // Also fetch recent completions for visibility
    const recentlyCompleted = await prisma.actionItem.findMany({
      where: { status: { in: ["done", "failed"] }, completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      take: 10,
      include: { session: { select: { id: true, title: true } } },
    });

    // ── Build response ────────────────────────────────────────

    return apiSuccess({
      // Quick summary line for agent orientation
      summary: [
        `${hosts.length} hosts discovered`,
        `${credentials.length} credentials (${credCoverage.reduce((s, c) => s + c.adminCount, 0)} admin accesses)`,
        `${globalSegments.filter((s) => reachableSegmentIds.has(s.id)).length}/${globalSegments.length} global segments reachable`,
        `${sessions.length} active sessions`,
        `${dbActions.filter((a) => a.status === "pending").length} pending / ${dbActions.filter((a) => a.status === "in_progress").length} active actions`,
      ].join(" | "),

      // Actions from DB — with ID, status, and who's working on what
      nextActions: dbActions.map((a) => ({
        id: a.id,
        priority: a.priority,
        action: a.action,
        reason: a.reason,
        category: a.category,
        target: a.target,
        context: JSON.parse(a.context),
        status: a.status,
        claimedBy: a.session ? { sessionId: a.session.id, title: a.session.title } : null,
        claimedAt: a.claimedAt,
      })),

      // What was recently done (so agent knows what's already been tried)
      recentlyCompleted: recentlyCompleted.map((a) => ({
        id: a.id,
        action: a.action,
        category: a.category,
        target: a.target,
        status: a.status,
        result: a.result,
        completedAt: a.completedAt,
        session: a.session ? { id: a.session.id, title: a.session.title } : null,
      })),

      // Compact state snapshot
      segments: segments.map((s) => ({
        id: s.id,
        name: s.name,
        cidr: s.cidr,
        scope: s.scope,
        ownerHost: s.ownerHost,
        reachable: reachableSegmentIds.has(s.id),
        hostCount: s.hostLinks.length,
      })),

      hostSummary: {
        total: hosts.length,
        unclaimed: unclaimed.length,
        stalled: stalled.length,
        inProgress: claimed.filter((h) =>
          h.checklists.some((c) => STATUS_KEYS.some((k) => c[k] === "in-progress"))
        ).length,
        completed: claimed.filter((h) =>
          h.checklists.some((c) => c.privescStatus === "done")
        ).length,
      },

      credentialSummary: {
        total: credentials.length,
        highValueCreds: highValueCreds.slice(0, 5),
      },

      adSummary: {
        domains: adDomains.map((d) => ({
          name: d.domainName,
          dcIp: d.dcIp,
          users: d.users.length,
          computers: d.computers.length,
          kerberoastable: d.users.filter((u) => u.kerberoastable).length,
          asrepRoastable: d.users.filter((u) => u.asrepRoastable).length,
        })),
      },

      scadaSummary: {
        devices: scadaDevices.length,
        nonZeroRegisters: scadaDevices.reduce(
          (sum, device) => sum + device.registers.filter((register) => register.isNonZero).length,
          0
        ),
        totalRegisters: scadaDevices.reduce((s, d) => s + d.registers.length, 0),
      },

      activeSessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        entries: s._count.entries,
        tasks: s._count.tasks,
      })),

      pendingTasks: pendingTasks.map((t) => ({
        id: t.id,
        type: t.type,
        title: t.title,
        priority: t.priority,
        hostIp: t.hostIp,
      })),

      recentEvents: recentEvents.slice(0, 15).map((e) => ({
        type: e.type,
        message: e.message,
        category: e.category,
        createdAt: e.createdAt,
      })),
    });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
