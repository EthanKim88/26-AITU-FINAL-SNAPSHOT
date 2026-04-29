#!/usr/bin/env python3
"""
Active Directory Enumeration Orchestrator for CTF competitions.

Automates comprehensive AD enumeration in two phases:
  Phase 1 - No credentials: DNS, SMB null session, LDAP anon bind, RPC null session
  Phase 2 - Authenticated: Full LDAP enum, Kerberoast, AS-REP, delegation, policies

Usage:
  python ad_enum.py -t 10.10.10.1
  python ad_enum.py -t 10.10.10.1 -d corp.local -u user -p pass
  python ad_enum.py -t 10.10.10.1 -d corp.local -u user -H aad3b435...
  python ad_enum.py -t 10.10.10.1 -o ad_enum.json
"""

from __future__ import annotations

import datetime
import json
import socket
import struct
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import click
import ldap3
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

# ---------------------------------------------------------------------------
# Conditional impacket imports -- graceful degradation if missing
# ---------------------------------------------------------------------------
try:
    from impacket.smbconnection import SMBConnection  # type: ignore[import-untyped]
    from impacket.dcerpc.v5 import transport as dce_transport  # type: ignore[import-untyped]
    from impacket.dcerpc.v5 import samr, lsat, lsad, epm  # type: ignore[import-untyped]
    from impacket.dcerpc.v5.dtypes import NULL  # type: ignore[import-untyped]

    HAS_IMPACKET = True
except ImportError:
    HAS_IMPACKET = False

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
LDAP_PORT = 389
LDAPS_PORT = 636
SMB_PORT = 445
CONNECT_TIMEOUT = 10

COMMON_AD_HOSTNAMES = ["dc", "dc01", "dc02", "exchange", "mail", "sql", "sql01", "web", "web01", "file", "fs", "ca", "adfs", "sccm"]

# UAC flag bitmask mapping (Microsoft docs)
UAC_FLAGS: dict[int, str] = {
    0x00000001: "SCRIPT",
    0x00000002: "ACCOUNTDISABLE",
    0x00000008: "HOMEDIR_REQUIRED",
    0x00000010: "LOCKOUT",
    0x00000020: "PASSWD_NOTREQD",
    0x00000040: "PASSWD_CANT_CHANGE",
    0x00000080: "ENCRYPTED_TEXT_PWD_ALLOWED",
    0x00000100: "TEMP_DUPLICATE_ACCOUNT",
    0x00000200: "NORMAL_ACCOUNT",
    0x00000800: "INTERDOMAIN_TRUST_ACCOUNT",
    0x00001000: "WORKSTATION_TRUST_ACCOUNT",
    0x00002000: "SERVER_TRUST_ACCOUNT",
    0x00010000: "DONT_EXPIRE_PASSWORD",
    0x00020000: "MNS_LOGON_ACCOUNT",
    0x00040000: "SMARTCARD_REQUIRED",
    0x00080000: "TRUSTED_FOR_DELEGATION",
    0x00100000: "NOT_DELEGATED",
    0x00200000: "USE_DES_KEY_ONLY",
    0x00400000: "DONT_REQUIRE_PREAUTH",
    0x00800000: "PASSWORD_EXPIRED",
    0x01000000: "TRUSTED_TO_AUTH_FOR_DELEGATION",
    0x04000000: "PARTIAL_SECRETS_ACCOUNT",
}

DOMAIN_FUNCTIONAL_LEVELS: dict[str, str] = {
    "0": "Windows 2000",
    "1": "Windows 2003 Interim",
    "2": "Windows 2003",
    "3": "Windows 2008",
    "4": "Windows 2008 R2",
    "5": "Windows 2012",
    "6": "Windows 2012 R2",
    "7": "Windows 2016",
}

console = Console()


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------
@dataclass
class EnumResults:
    """Aggregated results from all enumeration phases."""

    domain: str = ""
    dc_ip: str = ""
    domain_info: dict[str, Any] = field(default_factory=dict)
    dns_records: list[dict[str, str]] = field(default_factory=list)
    smb_shares: list[dict[str, str]] = field(default_factory=list)
    users: list[dict[str, Any]] = field(default_factory=list)
    groups: list[dict[str, Any]] = field(default_factory=list)
    computers: list[dict[str, Any]] = field(default_factory=list)
    domain_controllers: list[str] = field(default_factory=list)
    ous: list[str] = field(default_factory=list)
    gpos: list[dict[str, str]] = field(default_factory=list)
    trusts: list[dict[str, str]] = field(default_factory=list)
    kerberoastable_users: list[str] = field(default_factory=list)
    asrep_roastable_users: list[str] = field(default_factory=list)
    unconstrained_delegation: list[str] = field(default_factory=list)
    constrained_delegation: list[dict[str, Any]] = field(default_factory=list)
    rbcd: list[dict[str, Any]] = field(default_factory=list)
    admin_count_users: list[str] = field(default_factory=list)
    password_policy: dict[str, Any] = field(default_factory=dict)
    service_accounts: list[dict[str, Any]] = field(default_factory=list)
    attack_recommendations: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "domain": self.domain,
            "dc_ip": self.dc_ip,
            "domain_info": self.domain_info,
            "dns_records": self.dns_records,
            "smb_shares": self.smb_shares,
            "users": self.users,
            "groups": self.groups,
            "computers": self.computers,
            "domain_controllers": self.domain_controllers,
            "ous": self.ous,
            "gpos": self.gpos,
            "trusts": self.trusts,
            "kerberoastable_users": self.kerberoastable_users,
            "asrep_roastable_users": self.asrep_roastable_users,
            "unconstrained_delegation": self.unconstrained_delegation,
            "constrained_delegation": self.constrained_delegation,
            "rbcd": self.rbcd,
            "admin_count_users": self.admin_count_users,
            "password_policy": self.password_policy,
            "service_accounts": self.service_accounts,
            "attack_recommendations": self.attack_recommendations,
            "errors": self.errors,
        }


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------
def decode_uac(uac_value: int) -> list[str]:
    """Decode a userAccountControl bitmask into human-readable flag names."""
    flags: list[str] = []
    for bit, name in UAC_FLAGS.items():
        if uac_value & bit:
            flags.append(name)
    return flags


def filetime_to_str(ft: int | str | None) -> str:
    """Convert Windows FILETIME (100-ns intervals since 1601-01-01) to ISO string."""
    if ft is None:
        return "N/A"
    try:
        ft_int = int(ft)
    except (ValueError, TypeError):
        return str(ft)
    if ft_int <= 0 or ft_int == 0x7FFFFFFFFFFFFFFF:
        return "Never"
    epoch_diff = 116444736000000000
    if ft_int < epoch_diff:
        return "Never"
    timestamp = (ft_int - epoch_diff) / 10_000_000
    try:
        return datetime.datetime.fromtimestamp(timestamp, tz=datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    except (OSError, OverflowError, ValueError):
        return "Invalid"


def safe_str(value: Any) -> str:
    """Safely convert an LDAP attribute value to string."""
    if value is None:
        return ""
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.hex()
    if isinstance(value, list):
        return ", ".join(safe_str(v) for v in value)
    return str(value)


def get_attr(entry: ldap3.abstract.entry.Entry, attr: str) -> Any:
    """Safely retrieve an attribute from an ldap3 Entry object."""
    try:
        val = getattr(entry, attr, None)
        if val is None:
            return None
        raw = val.value
        if raw is None:
            return None
        return raw
    except (ldap3.core.exceptions.LDAPKeyError, ldap3.core.exceptions.LDAPAttributeError):
        return None


def get_attr_list(entry: ldap3.abstract.entry.Entry, attr: str) -> list[str]:
    """Safely retrieve a multi-valued attribute as a list of strings."""
    try:
        val = getattr(entry, attr, None)
        if val is None:
            return []
        raw = val.values
        if raw is None:
            return []
        return [safe_str(v) for v in raw]
    except (ldap3.core.exceptions.LDAPKeyError, ldap3.core.exceptions.LDAPAttributeError):
        return []


def phase_header(phase_num: int, title: str) -> None:
    """Print a styled phase header."""
    console.print()
    console.print(Panel(f"[bold cyan]PHASE {phase_num}[/bold cyan] - {title}", style="cyan", width=70))


def success(msg: str) -> None:
    console.print(f"  [green][+][/green] {msg}")


def info(msg: str) -> None:
    console.print(f"  [blue][*][/blue] {msg}")


def warn(msg: str) -> None:
    console.print(f"  [yellow][!][/yellow] {msg}")


def error(msg: str) -> None:
    console.print(f"  [red][-][/red] {msg}")


def high_value(msg: str) -> None:
    console.print(f"  [bold red][!!!][/bold red] {msg}")


def run_cmd(cmd: list[str], timeout: int = 15) -> tuple[str, str, int]:
    """Run a subprocess command with timeout, returning (stdout, stderr, returncode)."""
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return proc.stdout, proc.stderr, proc.returncode
    except FileNotFoundError:
        return "", f"Command not found: {cmd[0]}", 127
    except subprocess.TimeoutExpired:
        return "", "Command timed out", 124


def build_base_dn(domain: str) -> str:
    """Convert 'corp.local' to 'DC=corp,DC=local'."""
    return ",".join(f"DC={part}" for part in domain.split("."))


# ---------------------------------------------------------------------------
# Phase 1: No-credential enumeration
# ---------------------------------------------------------------------------
def phase1_dns(target: str, domain: str, results: EnumResults) -> None:
    """Phase 1.1 - DNS enumeration: zone transfer and common hostname resolution."""
    phase_header(1, "DNS Enumeration")

    # Attempt zone transfer if domain is known
    if domain:
        info(f"Attempting zone transfer for {domain} against {target}")
        stdout, stderr, rc = run_cmd(["dig", f"@{target}", domain, "AXFR"], timeout=15)
        if rc == 0 and stdout and "Transfer failed" not in stdout and "XFR size" in stdout:
            success("Zone transfer successful!")
            for line in stdout.splitlines():
                line = line.strip()
                if line and not line.startswith(";") and "\t" in line:
                    parts = line.split("\t")
                    if len(parts) >= 5:
                        record = {"name": parts[0].rstrip("."), "type": parts[3].strip(), "value": parts[4].strip().rstrip(".")}
                        results.dns_records.append(record)
                        info(f"  {record['name']} {record['type']} {record['value']}")
            if results.dns_records:
                success(f"Found {len(results.dns_records)} DNS records via zone transfer")
            else:
                warn("Zone transfer returned data but no parseable records")
        else:
            warn("Zone transfer failed or not allowed")

    # Resolve common AD hostnames
    resolve_domain = domain if domain else target
    info(f"Resolving common AD hostnames against {target}")
    for hostname in COMMON_AD_HOSTNAMES:
        fqdn = f"{hostname}.{resolve_domain}" if domain else hostname
        try:
            # Use the target as DNS server via dig for accuracy
            stdout, _, rc = run_cmd(["dig", f"@{target}", fqdn, "+short"], timeout=5)
            if rc == 0 and stdout.strip():
                ip = stdout.strip().splitlines()[0]
                success(f"  {fqdn} -> {ip}")
                results.dns_records.append({"name": fqdn, "type": "A", "value": ip})
        except Exception:
            pass

    # Try SRV records for domain controllers
    if domain:
        info("Querying SRV records for domain controllers")
        srv_queries = [
            f"_ldap._tcp.dc._msdcs.{domain}",
            f"_kerberos._tcp.{domain}",
            f"_gc._tcp.{domain}",
        ]
        for srv in srv_queries:
            stdout, _, rc = run_cmd(["dig", f"@{target}", srv, "SRV", "+short"], timeout=5)
            if rc == 0 and stdout.strip():
                for line in stdout.strip().splitlines():
                    parts = line.split()
                    if len(parts) >= 4:
                        srv_host = parts[3].rstrip(".")
                        success(f"  SRV {srv} -> {srv_host}")
                        results.dns_records.append({"name": srv, "type": "SRV", "value": srv_host})


def phase1_smb_null(target: str, results: EnumResults) -> None:
    """Phase 1.2 - SMB null session enumeration: shares, users, groups."""
    phase_header(1, "SMB Null Session Enumeration")

    if not HAS_IMPACKET:
        warn("impacket not installed -- skipping SMB enumeration")
        results.errors.append("impacket not installed, SMB enum skipped")
        return

    smb_conn: SMBConnection | None = None
    try:
        info(f"Attempting SMB null session to {target}")
        smb_conn = SMBConnection(target, target, sess_port=SMB_PORT, timeout=CONNECT_TIMEOUT)
        smb_conn.login("", "")
        success("SMB null session established!")

        # Enumerate shares
        try:
            shares = smb_conn.listShares()
            info("Enumerating shares:")
            for share in shares:
                share_name = share["shi1_netname"][:-1]  # strip null terminator
                share_remark = share["shi1_remark"][:-1] if share["shi1_remark"] else ""
                share_type_raw = share["shi1_type"]

                # Decode share type
                type_map = {0: "DISK", 1: "PRINTER", 2: "DEVICE", 3: "IPC"}
                share_type = type_map.get(share_type_raw & 0x0FFFFFFF, f"UNKNOWN({share_type_raw})")

                share_info = {"name": share_name, "type": share_type, "remark": share_remark}
                results.smb_shares.append(share_info)

                # Try listing root of each share to check access
                access = "NO ACCESS"
                try:
                    smb_conn.listPath(share_name, "*")
                    access = "READ"
                    share_info["access"] = access
                    high_value(f"  {share_name} ({share_type}) - {access} - {share_remark}")
                except Exception:
                    share_info["access"] = access
                    info(f"  {share_name} ({share_type}) - {access} - {share_remark}")

            success(f"Found {len(results.smb_shares)} shares")
        except Exception as exc:
            warn(f"Could not list shares: {exc}")

    except Exception as exc:
        warn(f"SMB null session failed: {exc}")
        results.errors.append(f"SMB null session failed: {exc}")
    finally:
        if smb_conn:
            try:
                smb_conn.close()
            except Exception:
                pass


def phase1_ldap_anon(target: str, results: EnumResults) -> None:
    """Phase 1.3 - LDAP anonymous bind: extract domain info."""
    phase_header(1, "LDAP Anonymous Bind")

    server = ldap3.Server(target, port=LDAP_PORT, get_info=ldap3.DSA, connect_timeout=CONNECT_TIMEOUT)
    conn: ldap3.Connection | None = None
    try:
        conn = ldap3.Connection(server, auto_bind=True, receive_timeout=CONNECT_TIMEOUT)
        success("LDAP anonymous bind successful!")

        dsa_info = server.info
        if dsa_info:
            # Naming contexts
            if dsa_info.naming_contexts:
                for nc in dsa_info.naming_contexts:
                    info(f"  Naming Context: {nc}")
                results.domain_info["naming_contexts"] = [str(nc) for nc in dsa_info.naming_contexts]

                # Derive domain from default naming context
                default_nc = str(dsa_info.naming_contexts[0])
                if not results.domain and "DC=" in default_nc:
                    domain_parts = []
                    for part in default_nc.split(","):
                        part = part.strip()
                        if part.upper().startswith("DC="):
                            domain_parts.append(part[3:])
                    if domain_parts:
                        results.domain = ".".join(domain_parts)
                        success(f"  Derived domain: {results.domain}")

            # Domain functional level
            if hasattr(dsa_info, "other") and dsa_info.other:
                func_level = dsa_info.other.get("domainFunctionality", [None])
                if func_level and func_level[0]:
                    level_str = str(func_level[0])
                    level_name = DOMAIN_FUNCTIONAL_LEVELS.get(level_str, f"Unknown ({level_str})")
                    results.domain_info["functional_level"] = level_name
                    info(f"  Domain Functional Level: {level_name}")

                forest_level = dsa_info.other.get("forestFunctionality", [None])
                if forest_level and forest_level[0]:
                    level_str = str(forest_level[0])
                    level_name = DOMAIN_FUNCTIONAL_LEVELS.get(level_str, f"Unknown ({level_str})")
                    results.domain_info["forest_functional_level"] = level_name
                    info(f"  Forest Functional Level: {level_name}")

                dc_level = dsa_info.other.get("domainControllerFunctionality", [None])
                if dc_level and dc_level[0]:
                    level_str = str(dc_level[0])
                    level_name = DOMAIN_FUNCTIONAL_LEVELS.get(level_str, f"Unknown ({level_str})")
                    results.domain_info["dc_functional_level"] = level_name
                    info(f"  DC Functional Level: {level_name}")

                server_name = dsa_info.other.get("serverName", [None])
                if server_name and server_name[0]:
                    results.domain_info["server_name"] = str(server_name[0])
                    info(f"  Server Name: {server_name[0]}")

                dns_hostname = dsa_info.other.get("dnsHostName", [None])
                if dns_hostname and dns_hostname[0]:
                    results.domain_info["dns_hostname"] = str(dns_hostname[0])
                    info(f"  DNS Hostname: {dns_hostname[0]}")

                ldap_service_name = dsa_info.other.get("ldapServiceName", [None])
                if ldap_service_name and ldap_service_name[0]:
                    results.domain_info["ldap_service_name"] = str(ldap_service_name[0])
                    info(f"  LDAP Service Name: {ldap_service_name[0]}")

            # Try to read schema info
            if dsa_info.schema_entry:
                results.domain_info["schema_entry"] = str(dsa_info.schema_entry)

        # Attempt anonymous search for basic objects
        if results.domain:
            base_dn = build_base_dn(results.domain)
            try:
                conn.search(base_dn, "(objectClass=*)", search_scope=ldap3.BASE, attributes=["*"])
                if conn.entries:
                    info("  Anonymous base search succeeded (domain root readable)")
            except Exception:
                pass

    except ldap3.core.exceptions.LDAPSocketOpenError:
        warn("LDAP connection refused or timed out")
        results.errors.append("LDAP anonymous bind failed: connection refused")
    except ldap3.core.exceptions.LDAPBindError as exc:
        warn(f"LDAP anonymous bind denied: {exc}")
        results.errors.append(f"LDAP anonymous bind denied: {exc}")
    except Exception as exc:
        warn(f"LDAP anonymous bind error: {exc}")
        results.errors.append(f"LDAP anonymous bind error: {exc}")
    finally:
        if conn:
            try:
                conn.unbind()
            except Exception:
                pass


def phase1_rpc_null(target: str, results: EnumResults) -> None:
    """Phase 1.4 - RPC null session via rpcclient."""
    phase_header(1, "RPC Null Session Enumeration")

    # Test rpcclient availability
    _, _, rc = run_cmd(["which", "rpcclient"], timeout=5)
    if rc != 0:
        warn("rpcclient not found -- skipping RPC enumeration")
        results.errors.append("rpcclient not installed, RPC enum skipped")
        return

    # Enumerate domain users
    info(f"Attempting RPC null session to {target}")
    stdout, stderr, rc = run_cmd(
        ["rpcclient", "-U", "%", "-N", target, "-c", "enumdomusers"],
        timeout=15,
    )
    if rc == 0 and stdout.strip() and "NT_STATUS" not in stdout:
        success("RPC null session - enumdomusers succeeded!")
        user_count = 0
        for line in stdout.strip().splitlines():
            # Format: user:[username] rid:[0x...]
            if "user:[" in line:
                username = line.split("user:[")[1].split("]")[0]
                info(f"  User: {username}")
                user_count += 1
                # Add to results if not already from LDAP
                existing = {u.get("username", "") for u in results.users}
                if username not in existing:
                    results.users.append({"username": username, "source": "rpc_null"})
        success(f"Found {user_count} users via RPC")
    else:
        warn("RPC enumdomusers failed or returned no results")

    # Enumerate domain groups
    stdout, stderr, rc = run_cmd(
        ["rpcclient", "-U", "%", "-N", target, "-c", "enumdomgroups"],
        timeout=15,
    )
    if rc == 0 and stdout.strip() and "NT_STATUS" not in stdout:
        success("RPC null session - enumdomgroups succeeded!")
        for line in stdout.strip().splitlines():
            if "group:[" in line:
                groupname = line.split("group:[")[1].split("]")[0]
                info(f"  Group: {groupname}")
                existing = {g.get("name", "") for g in results.groups}
                if groupname not in existing:
                    results.groups.append({"name": groupname, "source": "rpc_null"})
    else:
        warn("RPC enumdomgroups failed or returned no results")

    # Try to get domain password policy
    stdout, stderr, rc = run_cmd(
        ["rpcclient", "-U", "%", "-N", target, "-c", "getdompwinfo"],
        timeout=15,
    )
    if rc == 0 and stdout.strip() and "NT_STATUS" not in stdout:
        success("RPC null session - password policy info:")
        for line in stdout.strip().splitlines():
            info(f"  {line.strip()}")


# ---------------------------------------------------------------------------
# Phase 2: Authenticated enumeration
# ---------------------------------------------------------------------------
def _get_ldap_connection(
    target: str, domain: str, username: str, password: str, ntlm_hash: str
) -> tuple[ldap3.Connection | None, str]:
    """Establish an authenticated LDAP connection. Returns (connection, base_dn)."""
    base_dn = build_base_dn(domain)

    server = ldap3.Server(target, port=LDAP_PORT, get_info=ldap3.DSA, connect_timeout=CONNECT_TIMEOUT)

    # Build the user credential
    if ntlm_hash:
        # ldap3 NTLM authentication
        user_str = f"{domain}\\{username}"
        conn = ldap3.Connection(
            server,
            user=user_str,
            password=f"aad3b435b51404eeaad3b435b51404ee:{ntlm_hash}" if ":" not in ntlm_hash else ntlm_hash,
            authentication=ldap3.NTLM,
            auto_bind=True,
            receive_timeout=CONNECT_TIMEOUT,
        )
    else:
        user_str = f"{domain}\\{username}"
        conn = ldap3.Connection(
            server,
            user=user_str,
            password=password,
            authentication=ldap3.NTLM,
            auto_bind=True,
            receive_timeout=CONNECT_TIMEOUT,
        )

    return conn, base_dn


def _paged_search(
    conn: ldap3.Connection,
    base_dn: str,
    search_filter: str,
    attributes: list[str],
    scope: int = ldap3.SUBTREE,
) -> list[ldap3.abstract.entry.Entry]:
    """Execute a paged LDAP search and return all entries."""
    entries: list[ldap3.abstract.entry.Entry] = []
    page_size = 500
    cookie = True  # sentinel

    entry_generator = conn.extend.standard.paged_search(
        search_base=base_dn,
        search_filter=search_filter,
        search_scope=scope,
        attributes=attributes,
        paged_size=page_size,
        generator=True,
    )

    for entry in entry_generator:
        if entry.get("type") == "searchResEntry":
            # Wrap raw dict into a usable format
            entries.append(entry)

    return entries


def _safe_entry_attr(entry: dict[str, Any], attr: str) -> Any:
    """Get attribute from a raw paged search entry dict."""
    attrs = entry.get("raw_attributes", {}) if "raw_attributes" in entry else entry.get("attributes", {})
    val = attrs.get(attr)
    if val is None:
        return None
    if isinstance(val, list):
        if len(val) == 0:
            return None
        if len(val) == 1:
            v = val[0]
            if isinstance(v, bytes):
                try:
                    return v.decode("utf-8")
                except UnicodeDecodeError:
                    return v.hex()
            return v
        return [v.decode("utf-8") if isinstance(v, bytes) else v for v in val]
    if isinstance(val, bytes):
        try:
            return val.decode("utf-8")
        except UnicodeDecodeError:
            return val.hex()
    return val


def _safe_entry_attr_list(entry: dict[str, Any], attr: str) -> list[str]:
    """Get multi-valued attribute as list from raw paged search entry dict."""
    attrs = entry.get("raw_attributes", {}) if "raw_attributes" in entry else entry.get("attributes", {})
    val = attrs.get(attr)
    if val is None:
        return []
    if isinstance(val, list):
        result = []
        for v in val:
            if isinstance(v, bytes):
                try:
                    result.append(v.decode("utf-8"))
                except UnicodeDecodeError:
                    result.append(v.hex())
            else:
                result.append(str(v))
        return result
    return [str(val)]


def phase2_ldap_users(conn: ldap3.Connection, base_dn: str, results: EnumResults) -> None:
    """Phase 2.5a - Enumerate all domain users with key attributes."""
    info("Enumerating all domain users...")

    user_attrs = [
        "sAMAccountName", "description", "memberOf", "lastLogon",
        "pwdLastSet", "userAccountControl", "servicePrincipalName",
        "adminCount", "distinguishedName", "mail", "objectSid",
        "msDS-AllowedToDelegateTo", "msDS-AllowedToActOnBehalfOfOtherIdentity",
        "userPrincipalName",
    ]

    entries = _paged_search(conn, base_dn, "(&(objectCategory=person)(objectClass=user))", user_attrs)

    # Clear previous users from phase 1 null-session if we now have full data
    results.users = []

    for entry in entries:
        sam = _safe_entry_attr(entry, "sAMAccountName")
        if not sam:
            continue

        uac_raw = _safe_entry_attr(entry, "userAccountControl")
        uac_int = 0
        if uac_raw is not None:
            try:
                uac_int = int(uac_raw)
            except (ValueError, TypeError):
                pass

        uac_flags = decode_uac(uac_int)
        spns = _safe_entry_attr_list(entry, "servicePrincipalName")
        member_of = _safe_entry_attr_list(entry, "memberOf")
        description = _safe_entry_attr(entry, "description") or ""
        if isinstance(description, list):
            description = "; ".join(str(d) for d in description)
        admin_count_raw = _safe_entry_attr(entry, "adminCount")
        admin_count = False
        if admin_count_raw is not None:
            try:
                admin_count = int(admin_count_raw) == 1
            except (ValueError, TypeError):
                pass

        last_logon = _safe_entry_attr(entry, "lastLogon")
        pwd_last_set = _safe_entry_attr(entry, "pwdLastSet")
        allowed_to_delegate = _safe_entry_attr_list(entry, "msDS-AllowedToDelegateTo")
        dn = _safe_entry_attr(entry, "distinguishedName") or ""

        is_kerberoastable = bool(spns) and "ACCOUNTDISABLE" not in uac_flags and "krbtgt" != sam.lower()
        is_asrep = "DONT_REQUIRE_PREAUTH" in uac_flags and "ACCOUNTDISABLE" not in uac_flags

        user_record: dict[str, Any] = {
            "username": str(sam),
            "description": str(description),
            "groups": member_of,
            "flags": uac_flags,
            "spn": spns,
            "kerberoastable": is_kerberoastable,
            "asrep_roastable": is_asrep,
            "admin_count": admin_count,
            "last_logon": filetime_to_str(last_logon),
            "pwd_last_set": filetime_to_str(pwd_last_set),
            "constrained_delegation_targets": allowed_to_delegate,
            "dn": str(dn),
        }
        results.users.append(user_record)

        # Categorize
        if is_kerberoastable:
            results.kerberoastable_users.append(str(sam))
            spn_str = ", ".join(spns[:3])
            high_value(f"Kerberoastable: {sam} (SPN: {spn_str})")
        if is_asrep:
            results.asrep_roastable_users.append(str(sam))
            high_value(f"AS-REP Roastable: {sam} (no preauth required)")
        if admin_count:
            results.admin_count_users.append(str(sam))

        # Service account detection (heuristic: has SPN, name contains svc/service)
        sam_lower = str(sam).lower()
        if spns or "svc" in sam_lower or "service" in sam_lower:
            results.service_accounts.append({
                "username": str(sam),
                "spns": spns,
                "description": str(description),
            })

    success(f"Enumerated {len(results.users)} users")
    if results.kerberoastable_users:
        high_value(f"Total Kerberoastable: {len(results.kerberoastable_users)}")
    if results.asrep_roastable_users:
        high_value(f"Total AS-REP Roastable: {len(results.asrep_roastable_users)}")
    if results.admin_count_users:
        warn(f"AdminCount=1 users: {', '.join(results.admin_count_users)}")


def phase2_ldap_groups(conn: ldap3.Connection, base_dn: str, results: EnumResults) -> None:
    """Phase 2.5b - Enumerate all domain groups and memberships."""
    info("Enumerating all domain groups...")

    entries = _paged_search(
        conn, base_dn,
        "(objectCategory=group)",
        ["sAMAccountName", "description", "member", "distinguishedName", "groupType", "adminCount"],
    )

    results.groups = []

    for entry in entries:
        name = _safe_entry_attr(entry, "sAMAccountName")
        if not name:
            continue

        members = _safe_entry_attr_list(entry, "member")
        description = _safe_entry_attr(entry, "description") or ""
        if isinstance(description, list):
            description = "; ".join(str(d) for d in description)
        dn = _safe_entry_attr(entry, "distinguishedName") or ""
        group_type_raw = _safe_entry_attr(entry, "groupType")

        group_record = {
            "name": str(name),
            "description": str(description),
            "members": members,
            "member_count": len(members),
            "dn": str(dn),
        }

        # Decode group type
        if group_type_raw is not None:
            try:
                gt = int(group_type_raw)
                type_flags = []
                if gt & 0x00000002:
                    type_flags.append("Global")
                if gt & 0x00000004:
                    type_flags.append("DomainLocal")
                if gt & 0x00000008:
                    type_flags.append("Universal")
                if gt & -2147483648:  # 0x80000000 - security group
                    type_flags.append("Security")
                else:
                    type_flags.append("Distribution")
                group_record["type"] = ", ".join(type_flags)
            except (ValueError, TypeError):
                pass

        results.groups.append(group_record)

        # Highlight privileged groups
        name_lower = str(name).lower()
        priv_groups = [
            "domain admins", "enterprise admins", "schema admins",
            "administrators", "account operators", "server operators",
            "backup operators", "dnsadmins", "group policy creator owners",
        ]
        if name_lower in priv_groups and members:
            member_names = []
            for m in members[:10]:
                # Extract CN from DN
                if "CN=" in m:
                    cn = m.split(",")[0].replace("CN=", "")
                    member_names.append(cn)
            high_value(f"Privileged Group '{name}': {', '.join(member_names)}")

    success(f"Enumerated {len(results.groups)} groups")


def phase2_ldap_computers(conn: ldap3.Connection, base_dn: str, results: EnumResults) -> None:
    """Phase 2.5c - Enumerate all domain computers."""
    info("Enumerating all domain computers...")

    entries = _paged_search(
        conn, base_dn,
        "(objectCategory=computer)",
        [
            "sAMAccountName", "dNSHostName", "operatingSystem",
            "operatingSystemVersion", "operatingSystemServicePack",
            "userAccountControl", "lastLogon", "distinguishedName",
            "servicePrincipalName", "msDS-AllowedToDelegateTo",
            "msDS-AllowedToActOnBehalfOfOtherIdentity",
        ],
    )

    results.computers = []
    results.domain_controllers = []

    for entry in entries:
        sam = _safe_entry_attr(entry, "sAMAccountName") or ""
        dns_name = _safe_entry_attr(entry, "dNSHostName") or ""
        os_name = _safe_entry_attr(entry, "operatingSystem") or ""
        os_ver = _safe_entry_attr(entry, "operatingSystemVersion") or ""
        os_sp = _safe_entry_attr(entry, "operatingSystemServicePack") or ""
        dn = _safe_entry_attr(entry, "distinguishedName") or ""

        uac_raw = _safe_entry_attr(entry, "userAccountControl")
        uac_int = 0
        if uac_raw is not None:
            try:
                uac_int = int(uac_raw)
            except (ValueError, TypeError):
                pass
        uac_flags = decode_uac(uac_int)

        spns = _safe_entry_attr_list(entry, "servicePrincipalName")
        allowed_to_delegate = _safe_entry_attr_list(entry, "msDS-AllowedToDelegateTo")
        rbcd_raw = _safe_entry_attr(entry, "msDS-AllowedToActOnBehalfOfOtherIdentity")

        computer_record: dict[str, Any] = {
            "name": str(sam),
            "dns_hostname": str(dns_name),
            "os": str(os_name),
            "os_version": str(os_ver),
            "os_service_pack": str(os_sp),
            "flags": uac_flags,
            "dn": str(dn),
        }
        results.computers.append(computer_record)

        # Domain Controller detection
        if "SERVER_TRUST_ACCOUNT" in uac_flags:
            results.domain_controllers.append(str(sam))
            success(f"  Domain Controller: {sam} ({dns_name}) - {os_name}")

        # Unconstrained delegation (but not DCs -- DCs always have it)
        if "TRUSTED_FOR_DELEGATION" in uac_flags and "SERVER_TRUST_ACCOUNT" not in uac_flags:
            results.unconstrained_delegation.append(str(sam))
            high_value(f"Unconstrained Delegation: {sam} ({dns_name})")

        # Constrained delegation
        if allowed_to_delegate:
            results.constrained_delegation.append({
                "account": str(sam),
                "targets": allowed_to_delegate,
            })
            targets_str = ", ".join(allowed_to_delegate[:3])
            high_value(f"Constrained Delegation: {sam} -> {targets_str}")

        # RBCD
        if rbcd_raw:
            results.rbcd.append({
                "account": str(sam),
                "rbcd_raw": "present (binary data)",
            })
            warn(f"RBCD configured on: {sam}")

    success(f"Enumerated {len(results.computers)} computers, {len(results.domain_controllers)} DCs")


def phase2_ldap_ous(conn: ldap3.Connection, base_dn: str, results: EnumResults) -> None:
    """Phase 2.5d - Enumerate Organizational Units."""
    info("Enumerating Organizational Units...")

    entries = _paged_search(
        conn, base_dn,
        "(objectCategory=organizationalUnit)",
        ["distinguishedName", "name", "description"],
    )

    results.ous = []
    for entry in entries:
        dn = _safe_entry_attr(entry, "distinguishedName") or ""
        results.ous.append(str(dn))

    success(f"Enumerated {len(results.ous)} OUs")


def phase2_ldap_gpos(conn: ldap3.Connection, base_dn: str, results: EnumResults) -> None:
    """Phase 2.5e - Enumerate Group Policy Objects."""
    info("Enumerating Group Policy Objects...")

    entries = _paged_search(
        conn, base_dn,
        "(objectCategory=groupPolicyContainer)",
        ["displayName", "name", "gPCFileSysPath", "distinguishedName"],
    )

    results.gpos = []
    for entry in entries:
        display_name = _safe_entry_attr(entry, "displayName") or ""
        gpo_name = _safe_entry_attr(entry, "name") or ""
        gpc_path = _safe_entry_attr(entry, "gPCFileSysPath") or ""

        gpo_record = {
            "display_name": str(display_name),
            "name": str(gpo_name),
            "path": str(gpc_path),
        }
        results.gpos.append(gpo_record)
        info(f"  GPO: {display_name} ({gpo_name})")

    success(f"Enumerated {len(results.gpos)} GPOs")


def phase2_ldap_trusts(conn: ldap3.Connection, base_dn: str, results: EnumResults) -> None:
    """Phase 2.5f - Enumerate domain trusts."""
    info("Enumerating domain trusts...")

    entries = _paged_search(
        conn, base_dn,
        "(objectCategory=trustedDomain)",
        ["name", "trustDirection", "trustType", "trustAttributes", "flatName", "securityIdentifier"],
    )

    TRUST_DIRECTION = {0: "Disabled", 1: "Inbound", 2: "Outbound", 3: "Bidirectional"}
    TRUST_TYPE = {1: "Windows NT", 2: "Active Directory", 3: "MIT Kerberos"}

    results.trusts = []
    for entry in entries:
        name = _safe_entry_attr(entry, "name") or ""
        direction_raw = _safe_entry_attr(entry, "trustDirection")
        type_raw = _safe_entry_attr(entry, "trustType")
        flat_name = _safe_entry_attr(entry, "flatName") or ""

        direction = "Unknown"
        if direction_raw is not None:
            try:
                direction = TRUST_DIRECTION.get(int(direction_raw), f"Unknown ({direction_raw})")
            except (ValueError, TypeError):
                pass

        trust_type = "Unknown"
        if type_raw is not None:
            try:
                trust_type = TRUST_TYPE.get(int(type_raw), f"Unknown ({type_raw})")
            except (ValueError, TypeError):
                pass

        trust_record = {
            "name": str(name),
            "direction": direction,
            "type": trust_type,
            "flat_name": str(flat_name),
        }
        results.trusts.append(trust_record)
        warn(f"  Trust: {name} ({direction}, {trust_type})")

    success(f"Enumerated {len(results.trusts)} trusts")


def phase2_delegation(results: EnumResults) -> None:
    """Phase 2.8 - Summarize delegation findings (data collected in computer/user enum)."""
    phase_header(2, "Delegation Analysis")

    # Check user-based delegation (collected during user enum)
    for user in results.users:
        targets = user.get("constrained_delegation_targets", [])
        if targets:
            results.constrained_delegation.append({
                "account": user["username"],
                "targets": targets,
            })
            targets_str = ", ".join(targets[:3])
            high_value(f"Constrained Delegation (user): {user['username']} -> {targets_str}")

        if "TRUSTED_FOR_DELEGATION" in user.get("flags", []):
            if user["username"] not in results.unconstrained_delegation:
                results.unconstrained_delegation.append(user["username"])
                high_value(f"Unconstrained Delegation (user): {user['username']}")

    if not results.unconstrained_delegation and not results.constrained_delegation and not results.rbcd:
        info("No notable delegation configurations found")
    else:
        if results.unconstrained_delegation:
            high_value(f"Total Unconstrained Delegation: {len(results.unconstrained_delegation)} ({', '.join(results.unconstrained_delegation)})")
        if results.constrained_delegation:
            warn(f"Total Constrained Delegation entries: {len(results.constrained_delegation)}")
        if results.rbcd:
            warn(f"Total RBCD entries: {len(results.rbcd)}")


def phase2_password_policy(conn: ldap3.Connection, base_dn: str, results: EnumResults) -> None:
    """Phase 2.10 - Extract domain password policy."""
    phase_header(2, "Password Policy")

    try:
        conn.search(
            base_dn,
            "(objectClass=domain)",
            search_scope=ldap3.BASE,
            attributes=[
                "minPwdLength", "maxPwdAge", "minPwdAge",
                "pwdHistoryLength", "lockoutThreshold",
                "lockoutDuration", "lockOutObservationWindow",
                "pwdProperties",
            ],
        )

        if conn.entries:
            entry = conn.entries[0]

            def _get_policy_int(attr_name: str) -> int | None:
                val = get_attr(entry, attr_name)
                if val is None:
                    return None
                try:
                    return int(val)
                except (ValueError, TypeError):
                    return None

            def _filetime_to_minutes(ft: int | None) -> str:
                """Convert negative FILETIME duration to human-readable."""
                if ft is None or ft == 0:
                    return "Not set"
                # Negative FILETIME in 100-ns intervals
                abs_ft = abs(ft)
                minutes = abs_ft / (10_000_000 * 60)
                if minutes >= 1440:
                    days = minutes / 1440
                    return f"{days:.0f} days"
                if minutes >= 60:
                    hours = minutes / 60
                    return f"{hours:.1f} hours"
                return f"{minutes:.0f} minutes"

            min_length = _get_policy_int("minPwdLength")
            max_age = _get_policy_int("maxPwdAge")
            min_age = _get_policy_int("minPwdAge")
            history = _get_policy_int("pwdHistoryLength")
            lockout_threshold = _get_policy_int("lockoutThreshold")
            lockout_duration = _get_policy_int("lockoutDuration")
            lockout_window = _get_policy_int("lockOutObservationWindow")
            pwd_properties = _get_policy_int("pwdProperties")

            policy: dict[str, Any] = {}
            if min_length is not None:
                policy["min_length"] = min_length
                info(f"  Minimum Password Length: {min_length}")
            if max_age is not None:
                policy["max_age"] = _filetime_to_minutes(max_age)
                info(f"  Maximum Password Age: {policy['max_age']}")
            if min_age is not None:
                policy["min_age"] = _filetime_to_minutes(min_age)
                info(f"  Minimum Password Age: {policy['min_age']}")
            if history is not None:
                policy["history_length"] = history
                info(f"  Password History Length: {history}")
            if lockout_threshold is not None:
                policy["lockout_threshold"] = lockout_threshold
                if lockout_threshold == 0:
                    high_value("Lockout Threshold: 0 (NO ACCOUNT LOCKOUT - spray freely!)")
                else:
                    warn(f"  Lockout Threshold: {lockout_threshold} attempts")
            if lockout_duration is not None:
                policy["lockout_duration"] = _filetime_to_minutes(lockout_duration)
                info(f"  Lockout Duration: {policy['lockout_duration']}")
            if lockout_window is not None:
                policy["lockout_observation_window"] = _filetime_to_minutes(lockout_window)
                info(f"  Lockout Observation Window: {policy['lockout_observation_window']}")
            if pwd_properties is not None:
                complexity = bool(pwd_properties & 1)
                policy["complexity_enabled"] = complexity
                info(f"  Password Complexity: {'Enabled' if complexity else 'Disabled'}")

            results.password_policy = policy
            success("Password policy retrieved")
        else:
            warn("Could not read password policy from domain root")
    except Exception as exc:
        warn(f"Password policy query failed: {exc}")
        results.errors.append(f"Password policy query failed: {exc}")


def phase2_full_enum(
    target: str, domain: str, username: str, password: str, ntlm_hash: str, results: EnumResults
) -> None:
    """Phase 2 - Full authenticated LDAP enumeration."""
    phase_header(2, "Authenticated LDAP Enumeration")

    conn: ldap3.Connection | None = None
    try:
        info(f"Authenticating as {domain}\\{username}")
        conn, base_dn = _get_ldap_connection(target, domain, username, password, ntlm_hash)
        success("LDAP authentication successful!")

        # Sub-phases
        phase2_ldap_users(conn, base_dn, results)
        phase2_ldap_groups(conn, base_dn, results)
        phase2_ldap_computers(conn, base_dn, results)
        phase2_ldap_ous(conn, base_dn, results)
        phase2_ldap_gpos(conn, base_dn, results)
        phase2_ldap_trusts(conn, base_dn, results)
        phase2_delegation(results)
        phase2_password_policy(conn, base_dn, results)

    except ldap3.core.exceptions.LDAPBindError as exc:
        error(f"LDAP authentication failed: {exc}")
        results.errors.append(f"LDAP auth failed: {exc}")
    except ldap3.core.exceptions.LDAPSocketOpenError:
        error("LDAP connection refused or timed out")
        results.errors.append("LDAP connection refused during authenticated enum")
    except Exception as exc:
        error(f"Authenticated enumeration error: {exc}")
        results.errors.append(f"Authenticated enum error: {exc}")
    finally:
        if conn:
            try:
                conn.unbind()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Attack recommendation engine
# ---------------------------------------------------------------------------
def generate_recommendations(results: EnumResults) -> list[str]:
    """Generate prioritized attack recommendations based on findings."""
    recs: list[str] = []

    # Kerberoasting
    for user in results.kerberoastable_users:
        user_data = next((u for u in results.users if u.get("username") == user), None)
        spns = user_data.get("spn", []) if user_data else []
        spn_str = spns[0] if spns else "unknown SPN"
        recs.append(f"Kerberoast {user} (SPN: {spn_str}) -- use GetUserSPNs.py or kerberoast.py")

    # AS-REP roasting
    for user in results.asrep_roastable_users:
        recs.append(f"AS-REP Roast {user} (no preauth required) -- use GetNPUsers.py")

    # Unconstrained delegation
    for host in results.unconstrained_delegation:
        recs.append(f"Unconstrained delegation on {host} -- potential for printer bug / coerce attack")

    # Constrained delegation
    for entry in results.constrained_delegation:
        account = entry.get("account", "unknown")
        targets = entry.get("targets", [])
        if targets:
            recs.append(f"Constrained delegation: {account} can delegate to {targets[0]} -- S4U2Proxy attack")

    # RBCD
    for entry in results.rbcd:
        account = entry.get("account", "unknown")
        recs.append(f"RBCD configured on {account} -- investigate for privilege escalation")

    # Password policy weaknesses
    policy = results.password_policy
    if policy:
        lockout = policy.get("lockout_threshold", -1)
        if lockout == 0:
            recs.append("No account lockout policy -- password spraying is safe (use pth_spray.py)")
        elif isinstance(lockout, int) and lockout > 0:
            recs.append(f"Lockout threshold is {lockout} -- spray carefully with delays")

        min_len = policy.get("min_length", -1)
        if isinstance(min_len, int) and 0 < min_len <= 7:
            recs.append(f"Weak minimum password length ({min_len}) -- short passwords likely exist")

        if not policy.get("complexity_enabled", True):
            recs.append("Password complexity is DISABLED -- simple passwords likely exist")

    # Interesting descriptions (might contain passwords)
    for user in results.users:
        desc = user.get("description", "")
        if desc:
            desc_lower = desc.lower()
            triggers = ["pass", "pwd", "credential", "temp", "default", "changeme", "welcome"]
            if any(t in desc_lower for t in triggers):
                recs.append(f"Interesting description for {user['username']}: \"{desc}\"")

    # AdminCount users that are not built-in
    builtin_admins = {"administrator", "krbtgt"}
    custom_admins = [u for u in results.admin_count_users if u.lower() not in builtin_admins]
    if custom_admins:
        recs.append(f"Custom adminCount=1 users: {', '.join(custom_admins)} -- high-value targets")

    # Readable shares
    readable_shares = [s for s in results.smb_shares if s.get("access") == "READ" and s["name"] not in ("IPC$",)]
    if readable_shares:
        share_names = ", ".join(s["name"] for s in readable_shares)
        recs.append(f"Readable SMB shares (null session): {share_names} -- enumerate for sensitive files")

    # Trusts
    for trust in results.trusts:
        recs.append(f"Domain trust with {trust['name']} ({trust['direction']}) -- potential lateral movement path")

    # DNS zone transfer
    if results.dns_records:
        recs.append(f"DNS returned {len(results.dns_records)} records -- review for internal hostnames and hidden services")

    return recs


# ---------------------------------------------------------------------------
# Summary display
# ---------------------------------------------------------------------------
def print_summary(results: EnumResults) -> None:
    """Print a rich summary table of all findings."""
    console.print()
    console.print(Panel("[bold white]ENUMERATION SUMMARY[/bold white]", style="bold cyan", width=70))

    # Overview table
    overview = Table(title="Domain Overview", show_header=True, header_style="bold magenta")
    overview.add_column("Property", style="cyan")
    overview.add_column("Value", style="white")

    overview.add_row("Domain", results.domain or "Unknown")
    overview.add_row("DC IP", results.dc_ip)
    overview.add_row("Functional Level", results.domain_info.get("functional_level", "Unknown"))
    overview.add_row("DNS Hostname", results.domain_info.get("dns_hostname", "Unknown"))
    overview.add_row("Users Found", str(len(results.users)))
    overview.add_row("Groups Found", str(len(results.groups)))
    overview.add_row("Computers Found", str(len(results.computers)))
    overview.add_row("Domain Controllers", str(len(results.domain_controllers)))
    overview.add_row("GPOs", str(len(results.gpos)))
    overview.add_row("Trusts", str(len(results.trusts)))
    overview.add_row("SMB Shares", str(len(results.smb_shares)))
    console.print(overview)

    # High-value findings table
    if results.kerberoastable_users or results.asrep_roastable_users or results.unconstrained_delegation or results.admin_count_users:
        console.print()
        hv_table = Table(title="HIGH-VALUE Findings", show_header=True, header_style="bold red")
        hv_table.add_column("Category", style="red")
        hv_table.add_column("Count", style="yellow", justify="right")
        hv_table.add_column("Details", style="white")

        if results.kerberoastable_users:
            hv_table.add_row("Kerberoastable", str(len(results.kerberoastable_users)), ", ".join(results.kerberoastable_users[:10]))
        if results.asrep_roastable_users:
            hv_table.add_row("AS-REP Roastable", str(len(results.asrep_roastable_users)), ", ".join(results.asrep_roastable_users[:10]))
        if results.unconstrained_delegation:
            hv_table.add_row("Unconstrained Deleg.", str(len(results.unconstrained_delegation)), ", ".join(results.unconstrained_delegation[:10]))
        if results.constrained_delegation:
            hv_table.add_row("Constrained Deleg.", str(len(results.constrained_delegation)), ", ".join(e["account"] for e in results.constrained_delegation[:10]))
        if results.rbcd:
            hv_table.add_row("RBCD", str(len(results.rbcd)), ", ".join(e["account"] for e in results.rbcd[:10]))
        if results.admin_count_users:
            hv_table.add_row("AdminCount=1", str(len(results.admin_count_users)), ", ".join(results.admin_count_users[:10]))

        console.print(hv_table)

    # Password policy table
    if results.password_policy:
        console.print()
        pp_table = Table(title="Password Policy", show_header=True, header_style="bold yellow")
        pp_table.add_column("Setting", style="cyan")
        pp_table.add_column("Value", style="white")

        for key, value in results.password_policy.items():
            display_key = key.replace("_", " ").title()
            pp_table.add_row(display_key, str(value))

        console.print(pp_table)

    # Attack recommendations
    if results.attack_recommendations:
        console.print()
        rec_table = Table(title="Attack Recommendations", show_header=True, header_style="bold red", show_lines=True)
        rec_table.add_column("#", style="yellow", justify="right", width=4)
        rec_table.add_column("Recommendation", style="white")

        for idx, rec in enumerate(results.attack_recommendations, 1):
            rec_table.add_row(str(idx), rec)

        console.print(rec_table)

    # Errors
    if results.errors:
        console.print()
        err_table = Table(title="Errors / Warnings", show_header=True, header_style="bold yellow")
        err_table.add_column("Error", style="yellow")

        for err_msg in results.errors:
            err_table.add_row(str(err_msg))

        console.print(err_table)


# ---------------------------------------------------------------------------
# JSON export
# ---------------------------------------------------------------------------
def export_json(results: EnumResults, output_path: str) -> None:
    """Write enumeration results to a JSON file."""
    data = results.to_dict()
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    success(f"Results saved to {out.resolve()}")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
@click.command(context_settings={"help_option_names": ["-h", "--help"]})
@click.option("-t", "--target", required=True, envvar="AD_DC_IP", help="Target DC IP address")
@click.option("-d", "--domain", default=None, envvar="AD_DOMAIN", help="Domain name (e.g. corp.local)")
@click.option("-u", "--username", default=None, envvar="AD_USERNAME", help="Username for authenticated enum")
@click.option("-p", "--password", default=None, envvar="AD_PASSWORD", help="Password for authenticated enum")
@click.option("-H", "--hash", "ntlm_hash", default=None, envvar="AD_HASH", help="NTLM hash (LM:NT or NT only)")
@click.option("-o", "--output", default=None, help="Output JSON file path")
@click.option("--timeout", default=10, type=int, help="Connection timeout in seconds")
@click.option("--skip-dns", is_flag=True, default=False, help="Skip DNS enumeration")
@click.option("--skip-smb", is_flag=True, default=False, help="Skip SMB null session")
@click.option("--skip-rpc", is_flag=True, default=False, help="Skip RPC null session")
def main(
    target: str,
    domain: str | None,
    username: str | None,
    password: str | None,
    ntlm_hash: str | None,
    output: str | None,
    timeout: int,
    skip_dns: bool,
    skip_smb: bool,
    skip_rpc: bool,
) -> None:
    """Active Directory Enumeration Orchestrator for CTF competitions.

    Runs comprehensive AD enumeration in two phases:
    Phase 1 (no creds): DNS, SMB null session, LDAP anon, RPC null session.
    Phase 2 (with creds): Full LDAP enumeration, Kerberoast, AS-REP, delegation, policies.
    """
    # Load .env from the project root (two levels up from this script)
    script_dir = Path(__file__).resolve().parent
    for candidate in [script_dir / ".env", script_dir.parent / ".env", script_dir.parent.parent / ".env"]:
        if candidate.is_file():
            load_dotenv(candidate)
            break

    global CONNECT_TIMEOUT
    CONNECT_TIMEOUT = timeout

    # Banner
    banner_text = Text()
    banner_text.append("AD Enumeration Orchestrator", style="bold cyan")
    banner_text.append("\n")
    banner_text.append("AITU CTF 26 Final", style="dim")
    console.print(Panel(banner_text, style="cyan", width=70))

    has_creds = bool(username and (password or ntlm_hash))

    info(f"Target:  {target}")
    info(f"Domain:  {domain or 'unknown (will attempt discovery)'}")
    if has_creds:
        auth_method = "NTLM hash" if ntlm_hash else "password"
        info(f"Auth:    {domain}\\{username} ({auth_method})")
    else:
        info("Auth:    None (Phase 1 only)")

    results = EnumResults(domain=domain or "", dc_ip=target)

    # ---- Phase 1: No credentials required ----
    console.print()
    console.print("[bold white]========== PHASE 1: Unauthenticated Enumeration ==========[/bold white]")

    if not skip_dns:
        try:
            phase1_dns(target, domain or "", results)
        except Exception as exc:
            error(f"DNS enumeration crashed: {exc}")
            results.errors.append(f"DNS enum error: {exc}")

    try:
        phase1_ldap_anon(target, results)
    except Exception as exc:
        error(f"LDAP anonymous bind crashed: {exc}")
        results.errors.append(f"LDAP anon error: {exc}")

    # Update domain if discovered via LDAP anon
    if results.domain and not domain:
        domain = results.domain
        info(f"Domain discovered: {domain}")

    if not skip_smb:
        try:
            phase1_smb_null(target, results)
        except Exception as exc:
            error(f"SMB null session crashed: {exc}")
            results.errors.append(f"SMB null error: {exc}")

    if not skip_rpc:
        try:
            phase1_rpc_null(target, results)
        except Exception as exc:
            error(f"RPC null session crashed: {exc}")
            results.errors.append(f"RPC null error: {exc}")

    # ---- Phase 2: Authenticated enumeration ----
    if has_creds:
        if not domain:
            error("Domain is required for authenticated enumeration (use -d or set AD_DOMAIN)")
            results.errors.append("Domain not specified for authenticated enum")
        else:
            console.print()
            console.print("[bold white]========== PHASE 2: Authenticated Enumeration ==========[/bold white]")

            try:
                phase2_full_enum(target, domain, username, password or "", ntlm_hash or "", results)
            except Exception as exc:
                error(f"Authenticated enumeration crashed: {exc}")
                results.errors.append(f"Auth enum error: {exc}")
    else:
        console.print()
        warn("No credentials provided -- skipping Phase 2 (authenticated enumeration)")
        warn("Provide -u/-p or -u/-H for full enumeration")

    # ---- Generate attack recommendations ----
    results.attack_recommendations = generate_recommendations(results)

    # ---- Print summary ----
    print_summary(results)

    # ---- Export JSON ----
    if output:
        export_json(results, output)

    console.print()
    console.print(Panel("[bold green]Enumeration complete.[/bold green]", style="green", width=70))


if __name__ == "__main__":
    main()
