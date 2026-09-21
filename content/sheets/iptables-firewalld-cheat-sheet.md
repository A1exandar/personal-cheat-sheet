+++
title = "iptables & firewalld Cheat Sheet"
date = 2026-09-21
description = "Manage Linux firewall rules directly with iptables, or through firewalld's zones on Fedora/RHEL, without locking yourself out."
tags = ["linux", "iptables", "firewalld", "security", "networking"]
+++

A practical reference for the two firewall tools you'll meet when `ufw` isn't available: `iptables`, the classic low-level packet filter, and `firewalld`, the zone-based front end used by default on Fedora/RHEL/Rocky/Alma (much like `ufw` is to Debian/Ubuntu).

## What they actually are

`iptables` talks almost directly to the kernel's packet filter (netfilter) — you build an ordered list of rules per chain, and the first match wins. `firewalld` sits on top of the same underlying filter and adds a friendlier, zone-based model with runtime vs. permanent configuration. Pick whichever your distribution already ships; don't run both at once.

## Most important warning: allow SSH before anything else

> On a remote server, setting a default-deny policy or reloading firewall rules without an explicit SSH allow rule **will drop your session and lock you out**. Always add the SSH rule first, and keep a second connection (or your cloud provider's console) open while testing.

## Checking current status

```bash
sudo iptables -L -n -v          # list all rules, numeric addresses, with packet/byte counters
```
```bash
sudo firewall-cmd --state        # is firewalld running at all
sudo firewall-cmd --list-all     # rules, services and ports for the active zone
```

## Allow SSH first

```bash
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT   # append a rule allowing inbound SSH
```
```bash
sudo firewall-cmd --add-service=ssh --permanent   # allow SSH, saved across reboots
sudo firewall-cmd --reload                        # apply the permanent config to the running firewall
```

## Default policies (iptables chains)

```bash
sudo iptables -P INPUT DROP     # drop anything inbound that isn't explicitly allowed
sudo iptables -P FORWARD DROP   # drop anything this host would otherwise route through
sudo iptables -P OUTPUT ACCEPT  # let the host itself make outbound connections freely
```
> Set policies **after** your allow rules are already in place (starting with SSH) — a `DROP` policy applied before that will cut your own session immediately.

## Allowing common ports

```bash
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT    # HTTP
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT   # HTTPS
sudo iptables -A INPUT -p udp --dport 53 -j ACCEPT    # DNS
```
```bash
sudo firewall-cmd --add-service=http --permanent    # HTTP, by service name
sudo firewall-cmd --add-service=https --permanent   # HTTPS
sudo firewall-cmd --add-port=8080/tcp --permanent   # an arbitrary port, by number
sudo firewall-cmd --reload                          # apply the permanent changes
```

## Allowing from a specific IP address

```bash
sudo iptables -A INPUT -s 203.0.113.10 -j ACCEPT   # allow everything from this one address
```
```bash
sudo firewall-cmd --add-source=203.0.113.10 --permanent   # trust this address in the current zone
sudo firewall-cmd --reload
```

## Blocking a port or an address

```bash
sudo iptables -A INPUT -s 198.51.100.55 -j DROP      # silently drop traffic from this address
sudo iptables -A INPUT -p tcp --dport 23 -j REJECT   # actively refuse Telnet, tells the sender
```
`DROP` gives no response at all (the connection just hangs); `REJECT` sends back an explicit refusal — useful during testing, less useful for hiding that a port is closed.

```bash
sudo firewall-cmd --add-rich-rule='rule family="ipv4" source address="198.51.100.55" reject' --permanent   # block one address
sudo firewall-cmd --reload
```

## Rule order matters (iptables)

```bash
sudo iptables -I INPUT 1 -s 198.51.100.55 -j DROP   # insert at position 1, ahead of existing allow rules
```
Rules are evaluated top to bottom, first match wins — `-A` appends to the end of the chain, `-I` inserts at a given position. A `DROP` added after a broader `ACCEPT` further up will never be reached.

## Viewing rules with line numbers, and deleting

```bash
sudo iptables -L INPUT --line-numbers   # show each rule's position, needed to delete by number
sudo iptables -D INPUT 3                # delete rule number 3 from the INPUT chain
```
```bash
sudo firewall-cmd --remove-service=http --permanent   # remove a previously-allowed service
sudo firewall-cmd --remove-port=8080/tcp --permanent  # remove a previously-allowed port
sudo firewall-cmd --reload
```

## Saving rules so they survive a reboot

`iptables` rules live only in memory until you save them — a reboot silently reverts to nothing.

```bash
sudo apt install iptables-persistent   # Debian/Ubuntu: installing this also prompts to save current rules
sudo netfilter-persistent save          # save the current rule set for next boot
```
`firewalld` doesn't have this problem: anything added with `--permanent` is already written to disk, `--reload` just makes it active immediately too.

## firewalld zones (brief)

```bash
sudo firewall-cmd --get-active-zones     # which zone each network interface is using
sudo firewall-cmd --get-default-zone      # the zone new interfaces get by default
sudo firewall-cmd --zone=public --list-all  # rules for a specific zone
```
A zone is a named trust level (`public`, `internal`, `trusted`, etc.) with its own rule set — an interface facing the internet and one facing an internal LAN can sit in different zones with very different rules, instead of one flat list for everything.

## Flushing all rules

```bash
sudo iptables -F   # remove every rule from every chain - policies (DROP/ACCEPT) are untouched
```
> `-F` does not reset the chain *policies*. If `INPUT`'s policy is already `DROP`, flushing the rules that allowed your own SSH connection will lock you out immediately — this is one of the most common ways people lose remote access to a server.

## Safety notes

- Always allow SSH (or your actual management port) before setting a default-deny policy or reloading rules.
- Keep a second session or an out-of-band console (cloud provider dashboard, serial console) open while testing any firewall change.
- Prefer `firewall-cmd`'s `--permanent` + `--reload` pattern over guessing whether a raw `iptables` rule set was saved — an unsaved rule silently disappears on reboot.
- Test on a non-production host first when you're unsure how a rule set interacts with existing ones — rule order matters and mistakes are easy to make.
