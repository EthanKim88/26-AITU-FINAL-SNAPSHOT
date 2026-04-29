---
name: update-host-routes
description: "Dedicated skill for collecting a host's routing/interface IPs and reflecting them in the MCP DB. Parses ip route/ip addr (ifconfig) output and saves via discover_host_routes."
argument-hint: "<host_ip_or_cidr>"
---

# Host Route/IP Update

Target: `$ARGUMENTS`

Argument parsing rules:
- 1st: `host_ip_or_cidr` (required)
  - Example: `10.10.110.21` (single host)
  - Example: `10.10.110.0/24` (bulk segment)

---

## Objective

1. If a single IP, update route/interface for that one host only.
2. If a CIDR, update all hosts in the current DB (`ctf://hosts`) belonging to that segment.
3. For each host, perform `discover_host_routes` to save, then `list_host_routes` to verify.

---

## Execution Procedure

### Phase 0: Determine Target Mode

1. If `host_ip_or_cidr` is in CIDR format (`x.x.x.x/yy`), process in `segment` mode; otherwise, process in `host` mode.
2. If a session exists, `heartbeat(sessionId)`.

---

### Phase 1: Build Target Host List

Build `targetHosts` (IP array).

`host` mode:
1. `targetHosts = [host_ip_or_cidr]`
2. If not in `ctf://hosts`, `add_host(ip=<host_ip_or_cidr>, status="up", notes="route audit target")`

`segment` mode:
1. Query `ctf://hosts` and read the current DB host list.
2. Include host.ip in `targetHosts` if any of the following conditions are met.
   - `host.segments[].segment.cidr == <target_cidr>`
   - host IP falls within the `<target_cidr>` range (fallback)
3. Deduplicate and sort by IP in ascending order.
4. If empty, record `add_note("no db hosts in segment: <target_cidr>")` and terminate.

---

### Phase 2: Collect Route/Interface Output Per Host

Iterate through `targetHosts` and for each host, collect the following via available access methods (SSH, webshell, WinRM, etc.).

Linux preferred:
```bash
ip -o -4 addr show
ip route show
```

Fallback:
```bash
ifconfig -a
route -n
```

Save the raw output as `add_loot(lootType="other", filename="route_<host_ip>.txt", ...)` if needed.

---

### Phase 3: DB Update

For each host, always use `discover_host_routes`:

```text
discover_host_routes(
  hostIp=<host_ip>,
  ipAddrOutput=<collected ip addr/ifconfig output>,
  ipRouteOutput=<collected ip route/route output>,
  replace=true
)
```

Use `replace=true` as default to overwrite with the current routing state.

---

### Phase 4: Verification

For each host:
1. Call `list_host_routes(hostIp=<host_ip>)`
2. Verify at minimum that the following are reflected:
   - Presence of default route (`0.0.0.0/0`)
   - Connected IP (`connectedIp` or `srcIp`)
   - Internal network CIDR routes (e.g., `10.x.x.x/24`)
3. Record `log_event(type="note", message="host routes updated: <host_ip>")`

---

## Rules

- No estimated value input. Reflect only actual command output.
- Use `add_host_route` only when individual manual addition is needed.
- Always prefer `discover_host_routes` when automatic parsing is possible.
- `lxcbr*` interfaces are excluded from automatic host-local segment creation targets (raw route data can still be saved).
- In segment mode, do not stop on individual host failures; continue processing the next host.
