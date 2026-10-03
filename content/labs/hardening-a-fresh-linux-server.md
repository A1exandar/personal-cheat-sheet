+++
title = "Hardening a Fresh Linux Server"
date = 2026-10-03
description = "A practical hardening checklist for a freshly provisioned Ubuntu/Debian server: users and SSH, firewall and fail2ban, automatic updates, time sync, kernel/network tuning, and the mistakes that lock you out."
tags = ["linux", "security", "hardening", "ssh", "sysadmin"]
+++

**Goal:** take a brand-new server straight after first boot - default image, root-only, nothing configured - and get it to a reasonable security baseline before anything else touches it. Written for a fresh Ubuntu/Debian VPS; package manager commands get a RHEL/Fedora equivalent noted inline where it differs.

**Why this order matters:** every step here is sequenced so you never lose access to the box partway through. The single most common way to turn "hardening a server" into "waiting on a support ticket to get console access back" is enabling the firewall before confirming SSH is allowed through it, or disabling password login before confirming key-based login actually works. Do each step, confirm it, *then* move to the next one that tightens things further.

## 1. Update the system immediately

A fresh image can be weeks or months old by the time you actually boot it.

```bash
sudo apt update && sudo apt upgrade -y   # Debian/Ubuntu - refresh package lists, then upgrade everything
sudo dnf upgrade -y                        # RHEL/Fedora equivalent
sudo reboot                                  # if the kernel itself was updated, nothing after this step runs on the old one
```

## 2. Create a non-root admin user

Stop using the `root` account directly for anything, starting now.

```bash
sudo adduser alex              # Debian/Ubuntu's interactive wrapper - prompts for a password and full name
sudo usermod -aG sudo alex       # grant admin rights via the sudo group
su - alex                          # switch into the new account and confirm it works
sudo whoami                          # should print "root" - confirms sudo access actually works
```

> Confirm `sudo whoami` works **in a second terminal, while your first session is still open**, before going any further. If it fails, you still have your original root session to fix it from - don't close that first session until the new account is proven working.

## 3. Harden SSH access

This is the step most likely to lock you out if done out of order - each change here assumes the previous one is already confirmed working.

**First, get key-based login working and confirmed, before touching passwords at all:**

```bash
ssh-keygen -t ed25519 -C "alex@laptop"     # on your LOCAL machine, not the server - generates a keypair
ssh-copy-id alex@server-ip                    # copies the public key to the server's authorized_keys for you
```

```bash
ssh alex@server-ip   # from a NEW terminal window - confirm key login works before changing anything server-side
```

**Only once that login succeeds**, edit the SSH daemon config:

```bash
sudo nano /etc/ssh/sshd_config
```

```text
PermitRootLogin no          # root can no longer log in over SSH at all, key or password
PasswordAuthentication no     # key-based login only - the big one, don't enable until keys are confirmed
PubkeyAuthentication yes        # should already be yes, confirm it explicitly
X11Forwarding no                  # not needed on a headless server
MaxAuthTries 3                      # limit brute-force guesses per connection attempt
```

```bash
sudo sshd -t                           # validate the config syntax before restarting - a typo here can lock out SSH entirely
sudo systemctl restart sshd              # apply the changes
```

```bash
ssh alex@server-ip   # from yet another new terminal - confirm you can still get in BEFORE closing your existing session
```

> Keep your current SSH session open until a brand-new connection attempt succeeds. If the new attempt fails, you still have a live session to revert `sshd_config` from - closing it first, "to be sure," is how people get locked out of their own servers.

## 4. Set up the firewall

```bash
sudo apt install ufw        # Debian/Ubuntu - usually already installed
sudo ufw allow OpenSSH         # or: sudo ufw allow 22/tcp - allow SSH BEFORE enabling the firewall
sudo ufw default deny incoming   # block everything else inbound by default
sudo ufw default allow outgoing    # let the server itself make outbound connections freely
sudo ufw enable                      # turn it on - confirms you want this, since it can disconnect you
sudo ufw status verbose                # confirm SSH is actually in the allowed list
```

```bash
sudo firewall-cmd --permanent --add-service=ssh   # RHEL/Fedora equivalent, firewalld
sudo firewall-cmd --reload
```

> Allowing SSH is step one here for a reason - enabling a default-deny firewall before that rule exists cuts your own session off immediately, with no way back in except console access through the hosting provider.

Only after SSH is confirmed allowed, open whatever else this server actually needs (`sudo ufw allow 80,443/tcp` for a web server, for example) - and nothing else.

## 5. Install fail2ban against brute-force attempts

```bash
sudo apt install fail2ban                      # Debian/Ubuntu
sudo systemctl enable --now fail2ban             # enable on boot and start now
```

```ini
# /etc/fail2ban/jail.local - create this file rather than editing jail.conf directly
[sshd]
enabled = true
maxretry = 3
bantime = 1h
findtime = 10m
```

```bash
sudo systemctl restart fail2ban
sudo fail2ban-client status sshd   # confirm the sshd jail is active and see current ban count
```

`jail.local` overrides `jail.conf` without being overwritten on a package update - never edit `jail.conf` itself for this reason.

## 6. Enable automatic security updates

```bash
sudo apt install unattended-upgrades    # Debian/Ubuntu
sudo dpkg-reconfigure --priority=low unattended-upgrades   # interactive prompt to enable it
```

```bash
sudo dnf install dnf-automatic              # RHEL/Fedora equivalent
sudo systemctl enable --now dnf-automatic.timer
```

```bash
cat /etc/apt/apt.conf.d/20auto-upgrades   # confirm it's actually enabled (both values should be "1")
```

A server that never gets rebooted to apply a kernel update is still exposed - unattended-upgrades handles packages, but plan for periodic reboots separately (or look into live-patching if reboots are genuinely not an option).

## 7. Synchronize the system clock

Logs, TLS certificate validation, and Kerberos/LDAP auth all quietly depend on correct time - worth confirming early, not after something downstream fails mysteriously.

```bash
timedatectl status                       # confirm NTP sync is active
sudo systemctl enable --now systemd-timesyncd   # the default lightweight client on most modern distros
```

```bash
sudo apt install chrony   # a more configurable alternative if timesyncd isn't already covering it
timedatectl status           # re-check after switching
```

## 8. Harden the kernel and network stack

```ini
# /etc/sysctl.d/99-hardening.conf
net.ipv4.conf.all.accept_redirects = 0     # don't let other hosts silently alter our routing
net.ipv4.conf.all.send_redirects = 0         # we're not a router, don't send redirects either
net.ipv4.icmp_echo_ignore_broadcasts = 1       # ignore ping floods sent to a broadcast address
net.ipv4.tcp_syncookies = 1                      # mitigate SYN-flood attacks
net.ipv4.conf.all.accept_source_route = 0          # reject source-routed packets, a classic spoofing vector
net.ipv4.conf.all.log_martians = 1                   # log obviously-spoofed/impossible source-address packets
```

```bash
sudo sysctl -p /etc/sysctl.d/99-hardening.conf   # apply immediately without a reboot
sudo sysctl net.ipv4.tcp_syncookies                # spot-check one value took effect
```

## 9. Lock down accounts and set a password policy

```bash
sudo passwd -l nobody                    # lock any default system account that doesn't need interactive login
awk -F: '$3 == 0 {print $1}' /etc/passwd   # confirm root is the ONLY account with UID 0
```

```bash
sudo apt install libpam-pwquality   # enforce password complexity for any account that still uses one
```

```text
# /etc/security/pwquality.conf
minlen = 12        # minimum password length
dcredit = -1          # require at least one digit
ucredit = -1            # require at least one uppercase letter
```

## 10. Remove unnecessary packages and services

```bash
ss -tulpn                              # what's actually listening, and on which interface
systemctl list-units --type=service --state=running   # every service currently running
```

```bash
sudo apt purge <unused-package>    # fully remove a package you don't recognize/need, including its config
sudo systemctl disable --now <service>   # stop a service and prevent it starting again on boot
```

Every listening service is attack surface. If something is listening and you can't explain *why* it needs to be, that's a question worth answering before deciding to leave it running.

## 11. Enable basic auditing

```bash
sudo apt install auditd              # Debian/Ubuntu
sudo systemctl enable --now auditd     # RHEL ships this enabled by default
```

```bash
sudo auditctl -w /etc/passwd -p wa -k passwd_changes   # watch for writes/attribute changes to /etc/passwd
sudo ausearch -k passwd_changes                            # review matching events later
```

A full audit policy is its own topic - even this one watch rule means an unexpected edit to `/etc/passwd` leaves a trail instead of vanishing silently.

## Verification - confirm it actually holds

```bash
sudo ufw status verbose                     # firewall rules as actually applied
sudo sshd -T | grep -E 'permitrootlogin|passwordauthentication'   # effective SSH config, not just the file on disk
sudo fail2ban-client status sshd              # fail2ban jail is live
systemctl is-enabled unattended-upgrades.service 2>/dev/null; cat /etc/apt/apt.conf.d/20auto-upgrades
timedatectl status                              # NTP sync is active
ss -tulpn                                         # final listening-ports sanity check
```

Run this list from a **fresh** SSH session, not the one you've had open throughout - that's the only way to catch a change that silently broke access for everyone except your currently-open session.

## Safety notes

- Never disable password authentication (`PasswordAuthentication no`) before a key-based login has been tested successfully in a separate session - this is the single most common self-inflicted lockout.
- Never `ufw enable` (or apply a default-deny firewall policy) before the SSH rule is already in place and confirmed - cloud providers' consoles can get you back in, but it costs real time you don't need to lose.
- Keep your original session open until every change in this list has been independently re-verified from a brand-new connection - closing it "once it looks fine" removes your only safety net if something was actually wrong.
- `jail.local` for fail2ban, not `jail.conf` - the latter gets overwritten on package upgrades, silently dropping any customization made directly to it.
- Treat this as a baseline, not a finish line - what else needs hardening depends heavily on what the server actually runs (a public web server, a database, an internal build box all need different additional attention beyond this checklist).
