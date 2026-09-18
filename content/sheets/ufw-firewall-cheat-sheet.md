+++
title = "UFW Firewall Cheat Sheet"
date = 2026-09-03
description = "Set up UFW on Ubuntu/Debian safely: allow SSH first, set default policies, open web ports, use app profiles and troubleshoot."
tags = ["linux", "ufw", "firewall", "security", "ubuntu"]
+++

A practical reference for configuring UFW on Ubuntu and Debian servers without locking yourself out.

## What UFW is

UFW (Uncomplicated Firewall) is a front end that generates and manages `iptables` / `nftables` rules for you. You write simple `allow` and `deny` statements; UFW compiles them into the kernel firewall. It does not replace the packet filter, it drives it.

## Install

```bash
sudo apt update
sudo apt install ufw
```

## Check status and version

```bash
sudo ufw status            # active or inactive
sudo ufw status verbose    # policies, logging, per-rule detail
sudo ufw version
```

## Most important warning: allow SSH before enabling

> On a remote server, enabling UFW while incoming traffic is denied by default will **drop your SSH session and lock you out**. Add a rule for the SSH port you actually use *before* running `ufw enable`.

Default SSH port:

```bash
sudo ufw allow 22/tcp
```

Custom SSH port (for example 2222):

```bash
sudo ufw allow 2222/tcp
```

Confirm the rule is listed, then continue. If you use a cloud provider, keep a web console or serial console open as a fallback while testing.

## Recommended default policies

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
```

This blocks all inbound traffic except what you explicitly allow, while letting the server make outbound connections (updates, DNS, package mirrors).

## Enable and disable

```bash
sudo ufw enable     # start firewall, load rules, enable at boot
sudo ufw disable    # stop firewall and disable at boot
```

## View active rules

```bash
sudo ufw status numbered   # rules with index numbers (needed for deletion)
sudo ufw status verbose    # full detail including default policies and logging
```

## Allow common ports

```bash
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 8080/tcp    # a custom TCP service
```

## Allow a UDP port

```bash
sudo ufw allow 51820/udp   # e.g. WireGuard
```

## Allow a port range

```bash
sudo ufw allow 6000:6007/tcp
sudo ufw allow 60000:61000/udp
```

A protocol (`/tcp` or `/udp`) is required when specifying a range.

## Application profiles

Profiles live in `/etc/ufw/applications.d/` and map a name to one or more ports.

```bash
sudo ufw app list             # list installed profiles
sudo ufw app info "Nginx Full"   # show what a profile opens
```

```bash
sudo ufw allow OpenSSH
sudo ufw allow "Nginx Full"    # opens 80 and 443, when the nginx package is installed
```

`Nginx Full`, `Nginx HTTP` and `Nginx HTTPS` appear only after the `nginx` package is installed. Use `"Nginx HTTP"` if you have not set up TLS yet.

## Allow from a specific IP address

```bash
# From one host, to anything on this server
sudo ufw allow from 203.0.113.10

# From one host, to a single port only
sudo ufw allow from 203.0.113.10 to any port 22 proto tcp

# From a whole subnet to the database port
sudo ufw allow from 10.0.0.0/24 to any port 5432 proto tcp
```

## Block a port or an IP address

```bash
sudo ufw deny 23/tcp                 # block Telnet
sudo ufw deny from 198.51.100.55     # block a host entirely
```

Rules are evaluated top to bottom, first match wins, so a `deny from` must sit *above* any broader `allow` for that traffic. Use `insert` to place it:

```bash
sudo ufw insert 1 deny from 198.51.100.55
```

## Delete rules

```bash
# By rule number (check the numbers first, they shift after each delete)
sudo ufw status numbered
sudo ufw delete 3

# By repeating the original rule
sudo ufw delete allow 8080/tcp
```

## Reload and reset

```bash
sudo ufw reload    # re-apply rules, e.g. after editing config files
```

> `sudo ufw reset` disables UFW and deletes **all** rules, returning it to defaults. On a remote server this also removes your SSH allow rule — re-add it before enabling again.

## IPv6

UFW manages IPv6 rules too, controlled by `IPV6=yes` in `/etc/default/ufw` (the default on current releases). If IPv6 rules are missing from `ufw status`, check that setting, then:

```bash
sudo ufw disable && sudo ufw enable
```

Rules written without an address (`sudo ufw allow 80/tcp`) apply to both IPv4 and IPv6.

## Minimal web server example

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
sudo ufw status verbose
```

## Minimal SSH-only server (custom port)

```bash
sudo ufw allow 2222/tcp
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
```

Make sure `sshd` is actually listening on 2222 (`Port 2222` in `/etc/ssh/sshd_config`, service restarted) before enabling.

## Troubleshooting

```bash
# Is the service actually listening on the port?
sudo ss -tulpn | grep :443

# Is UFW active and what does it allow?
sudo ufw status verbose

# Watch what UFW is blocking (enable logging first)
sudo ufw logging on
sudo tail -f /var/log/ufw.log
journalctl -k | grep '[UFW '
```

If a port is open in UFW and the service is listening but traffic still does not arrive, check your **cloud provider's firewall / security group** (AWS, GCP, Azure, Hetzner, DigitalOcean). Those rules sit in front of the instance and are separate from UFW.

## UFW is not the whole picture

A firewall limits exposure; it does not harden what is exposed. Keep the system patched (`unattended-upgrades`), use SSH key authentication with passwords disabled, run services with least privilege, and configure each service properly. UFW complements those, it does not replace them.
