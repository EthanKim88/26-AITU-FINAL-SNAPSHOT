#!/usr/bin/env python3
"""
Web enumeration scanner for CTF reconnaissance.

Automates common web enumeration tasks:
  - Quick wins: checks for exposed files (.env, .git/HEAD, backups, configs)
  - Directory enumeration: common admin panels, APIs, upload dirs
  - Tech fingerprinting: Server, X-Powered-By, framework detection
  - Flag detection: scans all 200 responses for flag patterns
  - Credential detection: searches config files for passwords/secrets
  - Downloads exposed files to a findings/ subdirectory

Dependencies: requests (in venv)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
except ImportError:
    print("ERROR: requests is required. Install with: pip install requests")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Built-in flag-like patterns (always checked as fallback)
_BUILTIN_FLAG_PATTERNS = [
    re.compile(r"(flag\{[^}]+\})"),
    re.compile(r"(cremitflag\{[^}]+\})"),
    re.compile(r"(AITU\{[^}]+\})"),
    re.compile(r"(AITUCTF\{[^}]+\})"),
    re.compile(r"(CTF\{[^}]+\})"),
    re.compile(r"(aitu\{[^}]+\})"),
]

# Will be populated at startup from API + builtins
FLAG_PATTERNS: list[re.Pattern[str]] = list(_BUILTIN_FLAG_PATTERNS)


def _load_flag_patterns_from_api(api_base: str = "http://localhost:10000") -> None:
    """Load custom flag format regex from the dashboard settings API and prepend to FLAG_PATTERNS."""
    global FLAG_PATTERNS
    import urllib.request
    for endpoint in [f"{api_base}/api/settings?key=flagFormat", f"{api_base}/api/context"]:
        try:
            req = urllib.request.Request(endpoint, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=2) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="replace"))
                fmt = ""
                if isinstance(data, dict):
                    fmt = data.get("value", "") or data.get("flagFormat", "") or ""
                fmt = fmt.strip()
                if fmt:
                    try:
                        custom = re.compile(f"({fmt})")
                        # Prepend so custom format is checked first; avoid duplicates
                        if not any(p.pattern == custom.pattern for p in FLAG_PATTERNS):
                            FLAG_PATTERNS = [custom] + FLAG_PATTERNS
                        return
                    except re.error:
                        pass
        except Exception:
            continue

CREDENTIAL_PATTERNS = [
    re.compile(r"""(?:password|passwd|pass)\s*[:=]\s*['"]?([^\s'"<>;,}{]{3,})""", re.IGNORECASE),
    re.compile(r"""(?:DB_PASS|DB_PASSWORD|MYSQL_PASSWORD|POSTGRES_PASSWORD)\s*[:=]\s*['"]?([^\s'"<>;,}{]{3,})""", re.IGNORECASE),
    re.compile(r"""(?:DB_USER|DB_USERNAME|MYSQL_USER)\s*[:=]\s*['"]?([^\s'"<>;,}{]{3,})""", re.IGNORECASE),
    re.compile(r"""(?:secret|secret_key|api_key|api_secret|token)\s*[:=]\s*['"]?([^\s'"<>;,}{]{3,})""", re.IGNORECASE),
    re.compile(r"""(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?([^\s'"<>;,}{]{3,})""", re.IGNORECASE),
]

# Credential context patterns: match the full line for better reporting
CREDENTIAL_LINE_PATTERNS = [
    re.compile(r""".*(?:password|passwd|pass|secret|token|key|DB_PASS|DB_USER|MYSQL_PASSWORD|API_KEY)\s*[:=]\s*['"]?[^\s'"<>;,}{]{3,}.*""", re.IGNORECASE),
]

EXPOSED_FILES = [
    ".env",
    ".git/HEAD",
    ".git/config",
    "config.php.bak",
    "config.php~",
    "config.php.old",
    "config.php.save",
    "config.bak",
    ".htaccess",
    "web.config",
    "backup.zip",
    "backup.tar.gz",
    "backup.sql",
    "dump.sql",
    "db.sql",
    "database.sql",
    "robots.txt",
    "sitemap.xml",
    "phpinfo.php",
    "info.php",
    ".DS_Store",
    "wp-config.php",
    "wp-config.php.bak",
    "wp-config.php~",
    "server-status",
    "server-info",
    ".svn/entries",
    ".svn/wc.db",
    "composer.json",
    "composer.lock",
    "package.json",
    "package-lock.json",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    ".dockerenv",
    "Makefile",
    "Gruntfile.js",
    "Gulpfile.js",
    ".env.local",
    ".env.production",
    ".env.development",
    ".env.backup",
    "application.yml",
    "application.properties",
    "appsettings.json",
    "settings.py",
    "config.json",
    "config.yaml",
    "config.yml",
    "credentials.json",
    "secrets.json",
    "id_rsa",
    ".ssh/id_rsa",
    ".ssh/authorized_keys",
    "crossdomain.xml",
    "clientaccesspolicy.xml",
    "security.txt",
    ".well-known/security.txt",
]

COMMON_DIRS = [
    "admin",
    "administrator",
    "login",
    "api",
    "api/v1",
    "api/v2",
    "dashboard",
    "panel",
    "cpanel",
    "upload",
    "uploads",
    "files",
    "images",
    "img",
    "static",
    "js",
    "css",
    "assets",
    "media",
    "backup",
    "backups",
    "config",
    "debug",
    "test",
    "testing",
    "dev",
    "cgi-bin",
    "console",
    "phpmyadmin",
    "pma",
    "adminer",
    "adminer.php",
    "wp-admin",
    "wp-login.php",
    "wp-content",
    "wp-includes",
    ".well-known",
    "status",
    "swagger",
    "swagger-ui",
    "docs",
    "doc",
    "v1",
    "v2",
    "graphql",
    "graphiql",
    "actuator",
    "actuator/env",
    "actuator/health",
    "actuator/beans",
    "actuator/mappings",
    "metrics",
    "health",
    "healthcheck",
    "info",
    "internal",
    "private",
    "secret",
    "hidden",
    "portal",
    "user",
    "users",
    "account",
    "register",
    "signup",
    "reset",
    "forgot",
    "flag",
    "flags",
    "flag.txt",
    "tmp",
    "temp",
    "log",
    "logs",
    "error",
    "errors",
    "trace",
    "debug",
    "env",
    "shell",
    "cmd",
    "command",
    "exec",
    "run",
    "eval",
    "manager",
    "manager/html",
    "jmx-console",
    "web-console",
    "invoker",
    "xmlrpc.php",
    "readme.html",
    "README.md",
    "LICENSE",
    "CHANGELOG",
    "INSTALL",
]

# Files whose content is likely to contain credentials
CONFIG_FILE_EXTENSIONS = {
    ".env", ".bak", ".old", ".save", ".cfg", ".conf", ".config",
    ".ini", ".yml", ".yaml", ".json", ".properties", ".xml",
    ".php", ".py", ".rb", ".txt", ".sql",
}

# ---------------------------------------------------------------------------
# HTTP session factory
# ---------------------------------------------------------------------------


def _make_session(timeout: float) -> requests.Session:
    """Create a requests session with retry logic and timeout defaults."""
    session = requests.Session()
    retry = Retry(
        total=1,
        backoff_factor=0.2,
        status_forcelist=[502, 503],
        allowed_methods=["GET", "HEAD"],
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Connection": "keep-alive",
    })
    return session


# ---------------------------------------------------------------------------
# Core enumeration functions
# ---------------------------------------------------------------------------


def _build_url(target: str, port: int, path: str, scheme: str) -> str:
    """Build a full URL from components."""
    # Strip leading slash from path
    path = path.lstrip("/")
    if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        return f"{scheme}://{target}/{path}"
    return f"{scheme}://{target}:{port}/{path}"


def _check_url(
    session: requests.Session,
    url: str,
    timeout: float,
    follow_redirects: bool = False,
) -> dict[str, Any] | None:
    """
    Send a GET request to url. Return result dict or None on error/timeout.
    """
    try:
        resp = session.get(
            url,
            timeout=timeout,
            allow_redirects=follow_redirects,
            verify=False,
        )
        result: dict[str, Any] = {
            "url": url,
            "status": resp.status_code,
            "size": len(resp.content),
            "headers": dict(resp.headers),
            "content": None,
        }
        # Store content for small text responses (< 1MB)
        content_type = resp.headers.get("Content-Type", "")
        if (
            resp.status_code == 200
            and result["size"] < 1_048_576
            and any(ct in content_type.lower() for ct in [
                "text/", "application/json", "application/xml",
                "application/javascript", "application/x-yaml",
            ])
        ):
            try:
                result["content"] = resp.text
            except Exception:
                pass
        # Also store content for small binary files that returned 200
        # (like .zip, .tar.gz) - store as bytes indicator
        elif resp.status_code == 200 and result["size"] > 0:
            result["content_binary"] = True

        return result
    except requests.exceptions.Timeout:
        return None
    except requests.exceptions.ConnectionError:
        return None
    except requests.exceptions.RequestException:
        return None


def _extract_tech(headers: dict[str, str]) -> dict[str, str | None]:
    """Extract technology fingerprint from HTTP response headers."""
    tech: dict[str, str | None] = {
        "server": headers.get("Server"),
        "powered_by": headers.get("X-Powered-By"),
        "framework": None,
        "content_type": headers.get("Content-Type"),
        "x_generator": headers.get("X-Generator"),
        "x_aspnet_version": headers.get("X-AspNet-Version"),
        "x_runtime": headers.get("X-Runtime"),
    }

    # Try to detect framework from headers
    set_cookie = headers.get("Set-Cookie", "")
    if "PHPSESSID" in set_cookie:
        tech["framework"] = "PHP"
    elif "JSESSIONID" in set_cookie:
        tech["framework"] = "Java/Tomcat"
    elif "ASP.NET_SessionId" in set_cookie:
        tech["framework"] = "ASP.NET"
    elif "connect.sid" in set_cookie:
        tech["framework"] = "Node.js/Express"
    elif "laravel_session" in set_cookie:
        tech["framework"] = "Laravel (PHP)"
    elif "csrftoken" in set_cookie or "django" in set_cookie.lower():
        tech["framework"] = "Django (Python)"
    elif "_rails" in set_cookie.lower() or "rack.session" in set_cookie.lower():
        tech["framework"] = "Ruby on Rails"
    elif "wordpress" in set_cookie.lower():
        tech["framework"] = "WordPress"

    # Check X-Powered-By for more hints
    powered = headers.get("X-Powered-By", "")
    if "Express" in powered:
        tech["framework"] = tech["framework"] or "Node.js/Express"
    elif "Servlet" in powered:
        tech["framework"] = tech["framework"] or "Java Servlet"

    # Clean up None values for output
    return {k: v for k, v in tech.items() if v is not None}


def _search_flags(text: str) -> list[str]:
    """Search text for any flag patterns. Return unique matches."""
    flags: list[str] = []
    for pattern in FLAG_PATTERNS:
        for match in pattern.finditer(text):
            flag = match.group(1)
            if flag not in flags:
                flags.append(flag)
    return flags


def _search_credentials(text: str, source: str) -> list[dict[str, str]]:
    """Search text for credential patterns. Return list of findings."""
    creds: list[dict[str, str]] = []
    seen: set[str] = set()

    lines = text.split("\n")
    for line in lines:
        line_stripped = line.strip()
        if not line_stripped:
            continue

        for pattern in CREDENTIAL_LINE_PATTERNS:
            if pattern.match(line_stripped):
                # Extract specific key=value pairs
                for cred_pat in CREDENTIAL_PATTERNS:
                    for match in cred_pat.finditer(line_stripped):
                        value = match.group(1).strip("'\"")
                        key = line_stripped
                        dedup = f"{key}:{value}"
                        if dedup not in seen:
                            seen.add(dedup)
                            # Determine if this is a username or password pattern
                            cred_entry: dict[str, str] = {
                                "line": line_stripped[:200],
                                "value": value,
                                "source": source,
                            }
                            if re.search(r"(?:user|USER|username|DB_USER)", line_stripped):
                                cred_entry["type"] = "username"
                            elif re.search(r"(?:pass|PASS|secret|SECRET|token|TOKEN|key|KEY)", line_stripped):
                                cred_entry["type"] = "password"
                            else:
                                cred_entry["type"] = "unknown"
                            creds.append(cred_entry)
                break

    return creds


def _is_config_file(path: str) -> bool:
    """Check if a path looks like it could contain configuration/credentials."""
    path_lower = path.lower()
    # Direct name matches
    config_names = {
        ".env", "config.php", "wp-config.php", "settings.py",
        "application.yml", "application.properties", "appsettings.json",
        "credentials.json", "secrets.json", "docker-compose.yml",
        "docker-compose.yaml", "config.json", "config.yaml", "config.yml",
    }
    basename = path.rsplit("/", 1)[-1] if "/" in path else path
    if basename.lower() in config_names:
        return True

    # Extension matches
    _, ext = os.path.splitext(path_lower)
    if ext in CONFIG_FILE_EXTENSIONS:
        return True

    # Pattern matches
    if any(kw in path_lower for kw in ["config", "secret", "credential", "password", ".bak", ".old"]):
        return True

    return False


# ---------------------------------------------------------------------------
# Main enumeration orchestration
# ---------------------------------------------------------------------------


def enumerate_target(
    target: str,
    port: int,
    timeout: float,
    threads: int,
    scheme: str | None = None,
    findings_dir: Path | None = None,
) -> dict[str, Any]:
    """
    Run full web enumeration against target:port.

    Returns a structured results dict.
    """
    # Auto-detect scheme
    if scheme is None:
        scheme = "https" if port in (443, 8443) else "http"

    # Suppress InsecureRequestWarning for self-signed certs
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    session = _make_session(timeout)

    results: dict[str, Any] = {
        "target": target,
        "port": port,
        "scheme": scheme,
        "scan_time": datetime.now(timezone.utc).isoformat(),
        "tech": {},
        "exposed_files": [],
        "directories": [],
        "flags_found": [],
        "credentials_found": [],
    }

    all_flags: list[str] = []
    all_creds: list[dict[str, str]] = []

    # ------------------------------------------------------------------
    # Step 0: Probe the root page for tech fingerprinting
    # ------------------------------------------------------------------
    base_url = _build_url(target, port, "/", scheme)
    print(f"[*] Probing {base_url} ...")
    root_result = _check_url(session, base_url, timeout, follow_redirects=True)
    if root_result:
        results["tech"] = _extract_tech(root_result["headers"])
        results["root_status"] = root_result["status"]
        results["root_size"] = root_result["size"]
        if root_result.get("content"):
            all_flags.extend(_search_flags(root_result["content"]))
    else:
        print(f"[!] Could not connect to {base_url} — target may be down")
        results["error"] = f"Could not connect to {base_url}"
        return results

    # ------------------------------------------------------------------
    # Step 1: Also check a known-404 path to establish baseline
    # ------------------------------------------------------------------
    not_found_url = _build_url(target, port, "/thispathshouldnotexist_404check_xyzzy", scheme)
    not_found_result = _check_url(session, not_found_url, timeout)
    baseline_404_status = not_found_result["status"] if not_found_result else 404
    baseline_404_size = not_found_result["size"] if not_found_result else 0

    # If the server returns 200 for everything (soft-404), we need size comparison
    soft_404 = baseline_404_status == 200
    if soft_404:
        print(f"[!] Soft-404 detected (status 200 for non-existent path, size={baseline_404_size})")

    # ------------------------------------------------------------------
    # Step 2: Check exposed files (parallel)
    # ------------------------------------------------------------------
    print(f"[*] Checking {len(EXPOSED_FILES)} common exposed files ({threads} threads) ...")

    file_results: list[dict[str, Any]] = []

    def _check_file(path: str) -> dict[str, Any] | None:
        url = _build_url(target, port, path, scheme)
        result = _check_url(session, url, timeout)
        if result is None:
            return None
        # Filter out 404s and non-interesting responses
        if result["status"] in (404, 403, 405, 500, 502, 503):
            return None
        # Handle soft-404: if server returns 200 for everything, compare sizes
        if soft_404 and result["status"] == 200:
            size_diff = abs(result["size"] - baseline_404_size)
            # If size is very close to baseline 404 page, skip it
            if size_diff < 50:
                return None
        return {"path": path, **result}

    with ThreadPoolExecutor(max_workers=threads) as executor:
        future_to_path = {
            executor.submit(_check_file, path): path
            for path in EXPOSED_FILES
        }
        for future in as_completed(future_to_path):
            result = future.result()
            if result is not None:
                file_results.append(result)

    # Process file results
    for fr in sorted(file_results, key=lambda x: x["path"]):
        entry = {
            "path": fr["path"],
            "status": fr["status"],
            "size": fr["size"],
            "url": fr["url"],
        }

        # Search content for flags and credentials
        content = fr.get("content")
        if content:
            found_flags = _search_flags(content)
            all_flags.extend(found_flags)
            if found_flags:
                entry["flags"] = found_flags

            if _is_config_file(fr["path"]):
                found_creds = _search_credentials(content, fr["url"])
                all_creds.extend(found_creds)
                if found_creds:
                    entry["credentials"] = found_creds

        results["exposed_files"].append(entry)

    found_count = len(results["exposed_files"])
    print(f"[+] Found {found_count} exposed file(s)")
    for ef in results["exposed_files"]:
        status_indicator = "200 OK" if ef["status"] == 200 else str(ef["status"])
        print(f"    {ef['path']:40s} [{status_indicator}] {ef['size']} bytes")

    # ------------------------------------------------------------------
    # Step 3: Directory enumeration (parallel)
    # ------------------------------------------------------------------
    print(f"[*] Checking {len(COMMON_DIRS)} common directories ({threads} threads) ...")

    dir_results: list[dict[str, Any]] = []

    def _check_dir(path: str) -> dict[str, Any] | None:
        url = _build_url(target, port, path + "/", scheme)
        result = _check_url(session, url, timeout)
        if result is None:
            return None
        # Keep 200, 301, 302, 401, 403 (interesting statuses)
        if result["status"] in (404, 405, 500, 502, 503):
            return None
        # Soft-404 filtering
        if soft_404 and result["status"] == 200:
            size_diff = abs(result["size"] - baseline_404_size)
            if size_diff < 50:
                return None
        return {"path": path, **result}

    with ThreadPoolExecutor(max_workers=threads) as executor:
        future_to_dir = {
            executor.submit(_check_dir, path): path
            for path in COMMON_DIRS
        }
        for future in as_completed(future_to_dir):
            result = future.result()
            if result is not None:
                dir_results.append(result)

    for dr in sorted(dir_results, key=lambda x: x["path"]):
        entry = {
            "path": dr["path"],
            "status": dr["status"],
            "size": dr["size"],
            "url": dr["url"],
        }

        # Search content for flags
        content = dr.get("content")
        if content:
            found_flags = _search_flags(content)
            all_flags.extend(found_flags)
            if found_flags:
                entry["flags"] = found_flags

        results["directories"].append(entry)

    dir_count = len(results["directories"])
    print(f"[+] Found {dir_count} accessible directory/path(s)")
    for d in results["directories"]:
        status_indicator = str(d["status"])
        note = ""
        if d["status"] == 301:
            note = " (redirect)"
        elif d["status"] == 302:
            note = " (redirect)"
        elif d["status"] == 401:
            note = " (auth required)"
        elif d["status"] == 403:
            note = " (forbidden)"
        print(f"    /{d['path']:39s} [{status_indicator}{note}] {d['size']} bytes")

    # ------------------------------------------------------------------
    # Step 4: Deduplicate flags and credentials
    # ------------------------------------------------------------------
    results["flags_found"] = list(dict.fromkeys(all_flags))
    results["credentials_found"] = all_creds

    # ------------------------------------------------------------------
    # Step 5: Download exposed files to findings/ directory
    # ------------------------------------------------------------------
    if findings_dir and results["exposed_files"]:
        findings_dir.mkdir(parents=True, exist_ok=True)
        print(f"\n[*] Downloading exposed files to {findings_dir}/ ...")

        for ef in results["exposed_files"]:
            if ef["status"] != 200 or ef["size"] == 0:
                continue
            # Build safe filename
            safe_name = ef["path"].replace("/", "_").replace("\\", "_")
            if safe_name.startswith("."):
                safe_name = "dot_" + safe_name[1:]
            filepath = findings_dir / safe_name

            try:
                url = ef["url"]
                resp = session.get(url, timeout=timeout, verify=False)
                if resp.status_code == 200:
                    filepath.write_bytes(resp.content)
                    print(f"    Saved: {filepath.name} ({len(resp.content)} bytes)")
                    ef["saved_to"] = str(filepath)
            except Exception as exc:
                print(f"    Failed to download {ef['path']}: {exc}")

    # ------------------------------------------------------------------
    # Step 6: Summary
    # ------------------------------------------------------------------
    print("\n" + "=" * 60)
    print(f"[*] Web Enumeration Summary for {scheme}://{target}:{port}")
    print("=" * 60)

    if results["tech"]:
        print("\n[Tech Stack]")
        for k, v in results["tech"].items():
            print(f"    {k}: {v}")

    if results["flags_found"]:
        print(f"\n[FLAGS FOUND: {len(results['flags_found'])}]")
        for flag in results["flags_found"]:
            print(f"    >>> {flag}")

    if results["credentials_found"]:
        print(f"\n[CREDENTIALS FOUND: {len(results['credentials_found'])}]")
        for cred in results["credentials_found"]:
            print(f"    [{cred['type']}] {cred['line'][:80]}")
            print(f"           source: {cred['source']}")

    print(f"\n[Stats]")
    print(f"    Exposed files: {len(results['exposed_files'])}")
    print(f"    Directories:   {len(results['directories'])}")
    print(f"    Flags:         {len(results['flags_found'])}")
    print(f"    Credentials:   {len(results['credentials_found'])}")
    print()

    # Remove raw content and headers from output to keep JSON clean
    for ef in results["exposed_files"]:
        ef.pop("content", None)
        ef.pop("content_binary", None)
        ef.pop("headers", None)
    for d in results["directories"]:
        d.pop("content", None)
        d.pop("content_binary", None)
        d.pop("headers", None)

    return results


# ---------------------------------------------------------------------------
# MCP Import helper
# ---------------------------------------------------------------------------


def _print_import_instructions(results: dict[str, Any]) -> None:
    """Print instructions for manually importing results into MCP."""
    target = results["target"]
    port = results["port"]

    print("\n[MCP Import Instructions]")
    print("=" * 60)

    if results["flags_found"]:
        print("\nFlags to submit:")
        for flag in results["flags_found"]:
            print(f'  submit_flag(value="{flag}", source="web_enum {target}:{port}", category="web")')

    if results["credentials_found"]:
        print("\nCredentials to add:")
        for cred in results["credentials_found"]:
            if cred["type"] == "password":
                print(f'  add_credential(username="???", secret="{cred["value"]}", '
                      f'secretType="password", source="web_enum {cred["source"]}")')
            elif cred["type"] == "username":
                print(f'  add_credential(username="{cred["value"]}", source="web_enum {cred["source"]}")')

    if results["exposed_files"]:
        print("\nLoot to record:")
        for ef in results["exposed_files"]:
            if ef["status"] == 200:
                saved = ef.get("saved_to", "N/A")
                print(f'  add_loot(filename="{ef["path"]}", source="{ef["url"]}", '
                      f'lootType="config", hostIp="{target}")')

    print()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Web enumeration scanner for CTF reconnaissance.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 web_enum.py -t 10.1.2.10 -p 80
  python3 web_enum.py -t 10.1.2.10 -p 80 -o /tmp/web_enum.json
  python3 web_enum.py -t 10.1.2.10 -p 443 --scheme https --timeout 5
  python3 web_enum.py -t 10.1.2.10 -p 8080 --import
        """,
    )
    parser.add_argument(
        "-t", "--target",
        required=True,
        help="Target IP or hostname (e.g. 10.1.2.10)",
    )
    parser.add_argument(
        "-p", "--port",
        type=int,
        default=80,
        help="Target port (default: 80)",
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help="Output JSON file path (default: /tmp/web_enum_{ip}_{port}.json)",
    )
    parser.add_argument(
        "--scheme",
        choices=["http", "https"],
        default=None,
        help="URL scheme (default: auto-detect based on port)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=3.0,
        help="Timeout per request in seconds (default: 3)",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=10,
        help="Number of concurrent threads (default: 10)",
    )
    parser.add_argument(
        "--import",
        dest="do_import",
        action="store_true",
        default=False,
        help="Print MCP import instructions for discovered findings",
    )
    parser.add_argument(
        "--no-download",
        action="store_true",
        default=False,
        help="Skip downloading exposed files to findings/ directory",
    )
    return parser.parse_args()


def main() -> None:
    """Entry point."""
    args = parse_args()

    # Load custom flag format from dashboard API (non-blocking, falls back to builtins)
    _load_flag_patterns_from_api()

    target = args.target
    port = args.port

    # Determine output path
    if args.output:
        output_path = Path(args.output)
    else:
        safe_ip = target.replace(".", "_")
        output_path = Path(f"/tmp/web_enum_{safe_ip}_{port}.json")

    # Determine findings directory
    findings_dir: Path | None = None
    if not args.no_download:
        findings_dir = output_path.parent / "findings" / f"{target.replace('.', '_')}_{port}"

    print()
    print("=" * 60)
    print(f" Web Enumeration Scanner")
    print(f" Target: {target}:{port}")
    print(f" Output: {output_path}")
    if findings_dir:
        print(f" Files:  {findings_dir}/")
    print(f" Threads: {args.threads}  Timeout: {args.timeout}s")
    print("=" * 60)
    print()

    # Run enumeration
    results = enumerate_target(
        target=target,
        port=port,
        timeout=args.timeout,
        threads=args.threads,
        scheme=args.scheme,
        findings_dir=findings_dir,
    )

    # Save results
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, default=str)
    print(f"[+] Results saved to: {output_path}")

    # MCP import instructions
    if args.do_import:
        _print_import_instructions(results)

    # Exit code: 0 if flags found, 1 otherwise (useful for scripting)
    if results["flags_found"]:
        print(f"\n[!!!] {len(results['flags_found'])} FLAG(S) FOUND!")
        sys.exit(0)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
