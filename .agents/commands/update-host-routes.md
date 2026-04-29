---
description: Dedicated skill execution wrapper for host route/interface IP inspection and DB update.
---

# /update-host-routes

`/update-host-routes <host_ip_or_cidr>`

Behavior:
1. Loads `.claude/skills/update-host-routes/SKILL.md`.
2. Parses arguments using `argument-hint` rules.
3. If the first argument is an IP, only that host is processed; if it is a CIDR, all hosts in that segment registered in the DB are iterated.
4. Follows the steps in the skill document: route collection (`ip route`, `ip addr`) -> `discover_host_routes` save -> `list_host_routes` verification.
