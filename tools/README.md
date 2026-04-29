# Installed Tools

## Python (venv - `.venv/`)

| Tool | Version | Purpose |
|---|---|---|
| impacket | 0.13.0 | AD attack toolkit (Kerberos, SMB, remote execution) |
| bloodhound | 1.9.0 | AD attack path data collection (ingestor) |
| enum4linux-ng | 1.3.10 | SMB/NetBIOS enumeration (Python rewrite of enum4linux) |

```bash
source .venv/bin/activate
```

### Impacket Key Commands

```bash
# AS-REP Roasting - obtain hashes for users with pre-authentication disabled
GetNPUsers.py <domain>/ -usersfile users.txt -no-pass -dc-ip <ip>

# AD hash dump
secretsdump.py <domain>/<user>:<pass>@<ip>

# Remote shell (Pass-the-Hash)
psexec.py <domain>/<user>@<ip> -hashes <lm:ntlm>

# SMB shared folder access
smbclient.py <domain>/<user>:<pass>@<ip>

# WMI remote execution
wmiexec.py <domain>/<user>@<ip> -hashes <lm:ntlm>
```

### BloodHound Ingestor

```bash
bloodhound-python -u <user> -p <pass> -d <domain> -ns <dc-ip>
```

### enum4linux-ng

```bash
enum4linux-ng -A <ip>            # Full enumeration (NetBIOS, SMB, RPC, LDAP)
```

## Homebrew

| Tool | Version | Purpose |
|---|---|---|
| nmap | 7.99 | Port scanning, service detection |
| neo4j | 2026.02.3 | Graph DB (BloodHound backend) |
| samba | 4.24.0 | SMB client tools (enum4linux-ng dependency) |
| openvpn | - | TryHackMe VPN connection |

### nmap

```bash
nmap -sV -sC <ip>                # Service version + default scripts
nmap -p- <ip>                    # Full port scan
nmap --script=smb-enum-shares,smb-enum-users -p 139,445 <ip>
```

### Neo4j

```bash
brew services start neo4j       # Start (http://localhost:7474)
brew services stop neo4j        # Stop
# Default credentials: neo4j / neo4j
```

### OpenVPN

```bash
sudo openvpn ~/Downloads/<username>.ovpn
```

## Go (Source Build)

| Tool | Version | Purpose | Path |
|---|---|---|---|
| kerbrute | dev (1.0.3) | Kerberos user enumeration, password spraying | `tools/kerbrute` (symlinked to `/usr/local/bin/kerbrute`) |

### kerbrute

```bash
kerbrute userenum --dc <ip> -d <domain> userlist.txt    # User enumeration
kerbrute bruteuser --dc <ip> -d <domain> passwords.txt <user>  # Password brute-force
```

## Not Installed (Install If Needed)

| Tool | Installation Method | Purpose |
|---|---|---|
| evil-winrm | `brew install evil-winrm` | WinRM remote shell (Pass-the-Hash) |
| bloodhound GUI | `brew install --cask bloodhound` | AD attack path visualization |
| hashcat / john | `brew install hashcat john` | Hash cracking |
