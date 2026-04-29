import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { apiGet } from "./api-client";

export function registerPrompts(server: McpServer) {
  server.registerPrompt("triage", {
    description: "Analyze current CTF engagement and recommend next actions",
  }, async () => {
    const [context, attackSurface] = await Promise.all([
      apiGet("/api/context"),
      apiGet("/api/attack-surface"),
    ]);

    return {
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Analyze the current CTF situation and recommend next actions.

## Context
${JSON.stringify(context, null, 2)}

## Attack Surface
${JSON.stringify(attackSurface, null, 2)}

Respond in the following format:
1. Status summary (one line)
2. Immediate actions (Tier 1) — up to 3, include specific commands
3. Mid-term objectives (Tier 2) — up to 3
4. Incomplete/unexplored areas`,
        },
      }],
    };
  });

  server.registerPrompt("analyze_host", {
    description: "Develop attack strategy for a specific host",
    argsSchema: { ip: z.string().describe("Target host IP address") },
  }, async ({ ip }) => {
    const [hosts, credentials, ad] = await Promise.all([
      apiGet("/api/hosts"),
      apiGet("/api/credentials"),
      apiGet("/api/ad"),
    ]);

    const hostList = hosts as { ip: string }[];
    const target = hostList.find((h) => h.ip === ip);

    return {
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Develop an attack strategy for host ${ip}.

## Host Info
${JSON.stringify(target || `Host ${ip} not found in inventory. Available hosts: ${hostList.map((h) => h.ip).join(", ")}`, null, 2)}

## Available Credentials
${JSON.stringify(credentials, null, 2)}

## AD Info
${JSON.stringify(ad, null, 2)}

Include the following:
1. Service analysis based on open ports
2. Available credentials + testing methods (specific commands)
3. Privilege escalation paths
4. Commands to execute (impacket, evil-winrm, crackmapexec, etc.)`,
        },
      }],
    };
  });

  server.registerPrompt("credential_spray_plan", {
    description: "Plan credential spray based on untested combinations",
  }, async () => {
    const [credentials, hosts] = await Promise.all([
      apiGet("/api/credentials"),
      apiGet("/api/hosts"),
    ]);

    return {
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Analyze the current credential matrix and plan a spray against untested combinations.

## Credentials
${JSON.stringify(credentials, null, 2)}

## Hosts
${JSON.stringify(hosts, null, 2)}

Output:
1. List of (credential, host, protocol) combinations to test — ranked by success probability
2. Execution commands for each combination (crackmapexec, evil-winrm, smbclient, etc.)
3. Precautions (account lockout, etc.)`,
        },
      }],
    };
  });

  server.registerPrompt("scada_analysis", {
    description: "Analyze SCADA registers to find anomalies",
  }, async () => {
    const scada = await apiGet("/api/scada");
    const devices = scada as { id: string; host: string; port: number }[];

    // Fetch all device details with registers
    const details = await Promise.all(
      devices.map((d) => apiGet(`/api/scada/${d.id}`))
    );

    return {
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Analyze SCADA register data and identify anomalies.

## Devices & Registers
${JSON.stringify(details, null, 2)}

Analysis:
1. Non-zero registers that can be decoded as ASCII/text
2. String combinations from consecutive registers
3. Suspicious value changes or unusual patterns
4. Further investigation directions based on each device's vendor/product information`,
        },
      }],
    };
  });
}
