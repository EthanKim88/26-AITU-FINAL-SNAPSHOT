import { prisma } from "@/lib/prisma";
import type { ImportResult, AdEnumData } from "../types";

export async function importAdEnum(data: AdEnumData): Promise<ImportResult> {
  const result: ImportResult = { format: "ad-enum", created: {}, updated: {}, errors: [] };

  const domainInfo = data.domain_info;
  const domainName = domainInfo?.domain_name || (data.domain as string) || "";
  if (!domainName) {
    result.errors.push("No domain name found");
    return result;
  }

  try {
    const domain = await prisma.adDomain.upsert({
      where: { domainName },
      update: {
        dcIp: domainInfo?.dc_ip ?? "",
        functionalLevel: domainInfo?.functional_level ?? "",
        forestLevel: domainInfo?.forest_level ?? "",
        dcLevel: domainInfo?.dc_level ?? "",
        dnsHostname: domainInfo?.dns_hostname ?? "",
        serverName: domainInfo?.server_name ?? "",
        passwordPolicy: JSON.stringify(domainInfo?.password_policy ?? {}),
        smbShares: JSON.stringify(domainInfo?.smb_shares ?? []),
        dnsRecords: JSON.stringify(domainInfo?.dns_records ?? []),
        ous: JSON.stringify(domainInfo?.ous ?? []),
        attackRecommendations: JSON.stringify(domainInfo?.attack_recommendations ?? []),
        errors: JSON.stringify(domainInfo?.errors ?? []),
        scanTime: new Date(),
      },
      create: {
        domainName,
        dcIp: domainInfo?.dc_ip ?? "",
        functionalLevel: domainInfo?.functional_level ?? "",
        forestLevel: domainInfo?.forest_level ?? "",
        dcLevel: domainInfo?.dc_level ?? "",
        dnsHostname: domainInfo?.dns_hostname ?? "",
        serverName: domainInfo?.server_name ?? "",
        passwordPolicy: JSON.stringify(domainInfo?.password_policy ?? {}),
        smbShares: JSON.stringify(domainInfo?.smb_shares ?? []),
        dnsRecords: JSON.stringify(domainInfo?.dns_records ?? []),
        ous: JSON.stringify(domainInfo?.ous ?? []),
        attackRecommendations: JSON.stringify(domainInfo?.attack_recommendations ?? []),
        errors: JSON.stringify(domainInfo?.errors ?? []),
      },
    });
    result.created.domains = 1;

    // Users
    if (data.users) {
      let count = 0;
      for (const u of data.users) {
        try {
          await prisma.adUser.upsert({
            where: { domainId_username: { domainId: domain.id, username: u.username } },
            update: {
              description: u.description ?? "", dn: u.dn ?? "",
              groups: JSON.stringify(u.groups ?? []),
              spn: JSON.stringify(u.spn ?? []),
              kerberoastable: u.kerberoastable ?? false, asrepRoastable: u.asrep_roastable ?? false,
              adminCount: u.admin_count ?? false, lastLogon: u.last_logon ?? "", pwdLastSet: u.pwd_last_set ?? "",
              constrainedDelegationTargets: JSON.stringify(u.constrained_delegation_targets ?? []),
              email: u.email ?? "",
            },
            create: {
              domainId: domain.id, username: u.username,
              description: u.description ?? "", dn: u.dn ?? "",
              groups: JSON.stringify(u.groups ?? []),
              spn: JSON.stringify(u.spn ?? []),
              kerberoastable: u.kerberoastable ?? false, asrepRoastable: u.asrep_roastable ?? false,
              adminCount: u.admin_count ?? false, lastLogon: u.last_logon ?? "", pwdLastSet: u.pwd_last_set ?? "",
              constrainedDelegationTargets: JSON.stringify(u.constrained_delegation_targets ?? []),
              email: u.email ?? "",
            },
          });
          count++;
        } catch (e) { result.errors.push(`User ${u.username}: ${e instanceof Error ? e.message : "unknown"}`); }
      }
      result.created.users = count;
    }

    // Groups
    if (data.groups) {
      let count = 0;
      for (const g of data.groups) {
        try {
          await prisma.adGroup.upsert({
            where: { domainId_name: { domainId: domain.id, name: g.name } },
            update: {
              description: g.description ?? "", dn: g.dn ?? "",
              members: JSON.stringify(g.members ?? []), memberCount: g.member_count ?? 0, groupType: g.group_type ?? "",
            },
            create: {
              domainId: domain.id, name: g.name,
              description: g.description ?? "", dn: g.dn ?? "",
              members: JSON.stringify(g.members ?? []), memberCount: g.member_count ?? 0, groupType: g.group_type ?? "",
            },
          });
          count++;
        } catch (e) { result.errors.push(`Group ${g.name}: ${e instanceof Error ? e.message : "unknown"}`); }
      }
      result.created.groups = count;
    }

    // Computers
    if (data.computers) {
      let count = 0;
      for (const c of data.computers) {
        try {
          await prisma.adComputer.upsert({
            where: { domainId_name: { domainId: domain.id, name: c.name } },
            update: {
              dnsHostname: c.dns_hostname ?? "", os: c.os ?? "", osVersion: c.os_version ?? "",
              osServicePack: c.os_service_pack ?? "",
              dn: c.dn ?? "", isDc: c.is_dc ?? false,
              unconstrainedDelegation: c.unconstrained_delegation ?? false,
              constrainedDelegation: JSON.stringify(c.constrained_delegation ?? []),
              rbcd: c.rbcd ?? false,
            },
            create: {
              domainId: domain.id, name: c.name,
              dnsHostname: c.dns_hostname ?? "", os: c.os ?? "", osVersion: c.os_version ?? "",
              osServicePack: c.os_service_pack ?? "",
              dn: c.dn ?? "", isDc: c.is_dc ?? false,
              unconstrainedDelegation: c.unconstrained_delegation ?? false,
              constrainedDelegation: JSON.stringify(c.constrained_delegation ?? []),
              rbcd: c.rbcd ?? false,
            },
          });
          count++;
        } catch (e) { result.errors.push(`Computer ${c.name}: ${e instanceof Error ? e.message : "unknown"}`); }
      }
      result.created.computers = count;
    }

    // Trusts
    if (data.trusts) {
      let count = 0;
      for (const t of data.trusts) {
        try {
          await prisma.adTrust.upsert({
            where: { domainId_name: { domainId: domain.id, name: t.name } },
            update: { direction: t.direction ?? "Unknown", trustType: t.trust_type ?? "Unknown", flatName: t.flat_name ?? "" },
            create: { domainId: domain.id, name: t.name, direction: t.direction ?? "Unknown", trustType: t.trust_type ?? "Unknown", flatName: t.flat_name ?? "" },
          });
          count++;
        } catch (e) { result.errors.push(`Trust ${t.name}: ${e instanceof Error ? e.message : "unknown"}`); }
      }
      result.created.trusts = count;
    }

    // GPOs
    if (data.gpos) {
      let count = 0;
      for (const g of data.gpos) {
        const gpoName = g.name || g.display_name;
        try {
          await prisma.adGpo.upsert({
            where: { domainId_name: { domainId: domain.id, name: gpoName } },
            update: { displayName: g.display_name, path: g.path ?? "" },
            create: { domainId: domain.id, name: gpoName, displayName: g.display_name, path: g.path ?? "" },
          });
          count++;
        } catch (e) { result.errors.push(`GPO ${g.display_name}: ${e instanceof Error ? e.message : "unknown"}`); }
      }
      result.created.gpos = count;
    }
  } catch (e) {
    result.errors.push(`Domain: ${e instanceof Error ? e.message : "unknown"}`);
  }

  return result;
}
