+++
title = "Networking Diagnostics Cheat Sheet"
date = 2026-10-01
description = "Diagnose network problems with ss, netstat, ping, traceroute and dig/nslookup: is a port open, is a host reachable, where does the connection stall, and is DNS resolving correctly."
tags = ["linux", "networking", "diagnostics", "sysadmin"]
+++

The standard troubleshooting ladder for "the network isn't working": is the local port actually listening (`ss`), can you reach the host at all (`ping`), where does the path break down (`traceroute`), and does the name even resolve to the right address (`dig`/`nslookup`).

## ss - socket statistics

```bash
ss -tulpn             # TCP + UDP listening sockets, with process name and PID
ss -tn                 # established TCP connections only
ss -s                    # summary: total sockets by state and protocol
```

```text
-t   TCP sockets
-u   UDP sockets
-l   listening sockets only
-p   show the process (PID/name) that owns the socket - needs root for other users' processes
-n   numeric output - skip slow DNS/service-name lookups
```

```bash
ss -tlnp | grep :443             # is anything listening on port 443?
ss -o state established '( dport = :22 or sport = :22 )'   # active SSH connections, with timer info
ss -tn state time-wait            # connections stuck in TIME_WAIT
```

`ss` replaces `netstat` on modern Linux - it reads directly from the kernel instead of parsing `/proc`, and is noticeably faster on a server with many connections.

## netstat - the older equivalent

```bash
netstat -tulpn        # same idea as ss -tulpn: listening TCP/UDP with process info
netstat -an             # all connections, numeric output
netstat -rn               # the routing table, numeric
netstat -i                  # interface statistics - packets, errors, drops
```

Not installed by default on many current distributions (part of the older `net-tools` package) - `ss`, `ip route`, and `ip -s link` cover the same ground and are usually already present.

## ping - basic reachability

```bash
ping example.com            # send ICMP echo requests until interrupted with Ctrl+C
ping -c 4 example.com         # send exactly 4 requests, then stop
ping -i 0.2 example.com         # send every 0.2 seconds instead of the 1-second default
ping -s 1400 example.com          # send a larger payload size, useful for MTU troubleshooting
```

```text
A reply means: the host is up, routing works in both directions, and nothing
in between is blocking ICMP. No reply means one of those is false - it does
NOT necessarily mean the host or service is down, since ICMP is often
filtered independently of the actual service (see the safety note below).
```

## traceroute and mtr - where the path breaks

```bash
traceroute example.com         # classic hop-by-hop path, one pass
traceroute -n example.com        # numeric output - skip reverse DNS on every hop
mtr example.com                    # continuous, live-updating traceroute with per-hop loss %
mtr -r -c 50 example.com             # report mode - run 50 cycles, then print a summary and exit
```

`traceroute` shows one snapshot; `mtr` keeps pinging every hop continuously, which makes intermittent packet loss at a specific hop much easier to spot than a single `traceroute` run.

## dig - DNS lookups

```bash
dig example.com                  # full answer, with the resolving process details
dig example.com +short             # just the resolved IP address(es)
dig example.com MX                   # look up a specific record type (MX, TXT, NS, AAAA, ...)
dig @8.8.8.8 example.com               # query a specific DNS server directly, bypassing local resolver settings
dig -x 203.0.113.5                       # reverse lookup - IP address to hostname
```

```bash
dig example.com +trace    # follow the full resolution chain from the root servers down
```

## nslookup - the older, more interactive alternative

```bash
nslookup example.com              # resolve a hostname using the system's configured resolver
nslookup example.com 8.8.8.8        # resolve using a specific DNS server
nslookup -type=MX example.com         # look up a specific record type
```

`dig` gives more detail and is generally preferred for scripting; `nslookup` is older and its output format has changed across versions, but it's still commonly pre-installed, including on systems where `dig` isn't.

## Checking a specific port or service directly

```bash
nc -zv example.com 443        # TCP port check - does anything accept a connection on 443?
nc -zuv example.com 53          # same, for UDP (less reliable - UDP has no connection handshake to confirm)
curl -v telnet://example.com:25  # another way to probe a raw TCP port, no nc required
timeout 3 bash -c "</dev/tcp/example.com/443" && echo open   # pure-bash TCP check, no extra tools needed
```

## Checking local configuration

```bash
ip addr show              # every interface and its assigned IP addresses
ip route show                # the routing table
cat /etc/resolv.conf            # which DNS servers this host is actually configured to use
hostname -I                       # this host's own IP address(es)
```

## Common recipes

```bash
# Is my web server actually listening, locally?
ss -tlnp | grep :80

# Can I reach the server at all, ignoring whether the app is up?
ping -c 3 server.example.com

# The app is unreachable - is it a network problem or a DNS problem?
dig server.example.com +short
nc -zv server.example.com 443

# Where exactly does the connection die on a multi-hop path?
mtr -r -c 50 server.example.com

# Confirm what DNS server a resolution actually used
dig example.com | grep SERVER
```

## Safety notes

- A failed `ping` doesn't prove a host or service is down - many servers and firewalls deliberately drop ICMP while happily serving real traffic on other ports. Confirm with `nc`/`curl` against the actual service port before concluding anything is unreachable.
- `traceroute`'s default probe type (UDP on Linux, ICMP on some other systems) can be blocked hop-by-hop even when the actual service traffic gets through fine - a `* * *` partway through doesn't always mean a real outage at that hop, some routers simply don't reply to traceroute probes (rate-limited or filtered) while still forwarding packets.
- `dig @8.8.8.8` (or any public resolver) bypasses whatever split-horizon/internal DNS your organization relies on - a name resolving fine against a public resolver but failing against the normal local resolver often means the opposite of what it looks like: internal DNS working as intended, not broken.
- Installing and leaving `nc` reachable on a server is a minor attack-surface increase in some hardened environments - it's fine for ad hoc diagnostics, but some security baselines flag it; check local policy before assuming it's always available.
