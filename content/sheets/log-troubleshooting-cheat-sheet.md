+++
title = "Log Troubleshooting Cheat Sheet"
date = 2026-09-28
description = "A practical workflow for troubleshooting with plain-text logs in /var/log: where to look first, tailing and searching fast, correlating logs across services, log rotation and disk-full recovery."
tags = ["linux", "logging", "troubleshooting", "sysadmin"]
+++

Most incidents get solved by reading the right log, fast. This sheet covers the classic flat-file logs under `/var/log` and the workflow for working through them under pressure. For systemd's binary journal specifically, see the [journalctl Cheat Sheet](/sheets/journalctl-cheat-sheet/) - many distributions use both side by side.

## Where to look first

```text
/var/log/syslog          # Debian/Ubuntu - general system log, most services log here
/var/log/messages        # RHEL/Fedora/CentOS - equivalent general system log
/var/log/auth.log        # Debian/Ubuntu - authentication, sudo, SSH login attempts
/var/log/secure          # RHEL/Fedora - equivalent auth log
/var/log/kern.log        # kernel messages logged to a file (dmesg is the live ring buffer)
/var/log/dpkg.log         # Debian/Ubuntu package install/remove history
/var/log/nginx/access.log  # nginx requests
/var/log/nginx/error.log   # nginx errors
/var/log/apache2/error.log # Apache errors (Debian/Ubuntu path)
/var/log/mysql/error.log   # MySQL/MariaDB errors
/var/log/cloud-init.log    # cloud-init provisioning, on cloud VM images
/var/log/boot.log          # boot-time service startup messages
```

Exact paths vary by distro and by how a package was installed - if a log isn't where you expect, check the service's config for a `log_file`/`ErrorLog` directive, or `systemctl status <service>` for a hint.

## Reading logs fast

```bash
tail -n 100 /var/log/syslog       # last 100 lines - the fastest first look
tail -f /var/log/nginx/error.log   # follow live as new lines arrive
less +G /var/log/syslog             # open a pager already scrolled to the end
```

```bash
# inside less:
/pattern      # search forward for "pattern"
?pattern      # search backward
n             # jump to the next match
N             # jump to the previous match
```

## Following multiple logs at once

```bash
tail -f /var/log/nginx/error.log /var/log/mysql/error.log   # tail interleaves both, prefixed by filename
multitail /var/log/nginx/error.log /var/log/auth.log          # split-pane live view, if installed
```

`multitail` isn't installed by default on most systems (`apt install multitail` / `dnf install multitail`) but is worth it once you're regularly watching more than one log during an incident.

## Searching for the interesting bits

```bash
grep -i "error\|fail\|denied\|refused" /var/log/syslog          # common trouble keywords, case-insensitive
grep -i "error" /var/log/nginx/error.log | tail -50                # last 50 error lines
grep -c "Failed password" /var/log/auth.log                        # how many failed SSH logins, total
grep -B2 -A2 "segfault" /var/log/kern.log                            # a crash, with 2 lines of context each side
```

## Filtering a plain-text log by time range

```bash
sed -n '/Sep 29 09:00/,/Sep 29 10:00/p' /var/log/syslog     # everything between two timestamps (syslog's own format)
awk '$0 >= "2026-09-29 09:00:00" && $0 <= "2026-09-29 10:00:00"' /var/log/nginx/error.log  # works when the log's own timestamp sorts as a string
```

Plain-text logs have no query language like `journalctl --since` - matching on the timestamp text itself (with `sed`/`awk`, see the [sed & awk Cheat Sheet](/sheets/sed-awk-cheat-sheet/)) is the usual workaround.

## Correlating an incident across logs

```bash
# Pull the same time window from two logs, side by side, to line up cause and effect
grep "10:1[0-5]" /var/log/nginx/error.log
grep "10:1[0-5]" /var/log/mysql/error.log
```

The general pattern for "why did X break at time T": find T in the log closest to the symptom (nginx, application), then check every other service's log for the same narrow window - the actual cause is often one or two lines in a completely different log file.

## Kernel and hardware issues

```bash
dmesg               # kernel ring buffer - driver, hardware, OOM-killer messages
dmesg -T             # same, with human-readable timestamps instead of seconds-since-boot
dmesg | grep -i "error\|fail\|oom"   # filter for the usual suspects
```

`dmesg` is the first place to check for a process that died with no application-level explanation - the OOM killer and hardware errors both show up here, not in the application's own log.

## Login history

```bash
last              # successful logins, most recent first
last -a            # same, with the hostname/IP in its own column
lastb              # failed login attempts (reads /var/log/btmp)
who                 # who's logged in right now
w                   # who's logged in, plus what they're running
```

## Log rotation (logrotate)

```bash
cat /etc/logrotate.conf                 # global defaults
ls /etc/logrotate.d/                     # per-service configs (nginx, apache2, mysql, ...)
cat /etc/logrotate.d/nginx                # see how a specific service rotates
```

```bash
logrotate -d /etc/logrotate.d/nginx        # dry run - show what WOULD happen, changes nothing
sudo logrotate -f /etc/logrotate.d/nginx    # force rotation right now
cat /var/lib/logrotate/status               # when each log was last rotated
```

## When logs fill the disk

```bash
du -sh /var/log/* | sort -rh | head -10     # largest logs, biggest first
df -h /var/log                                # confirm /var/log's filesystem is actually the one that's full
```

```bash
sudo truncate -s 0 /var/log/nginx/access.log        # safely empty a log a process is actively writing to
sudo systemctl reload nginx                            # reload so nginx reopens a rotated/truncated log file
```

`> file.log` and `truncate -s 0 file.log` both work, but `truncate` doesn't require the shell to have write access to the directory the same way redirection does, and makes the intent explicit in scripts.

## Common recipes

```bash
# Was this an SSH brute-force attempt?
grep "Failed password" /var/log/auth.log | awk '{print $(NF-3)}' | sort | uniq -c | sort -rn

# What changed right before a service crashed - broad net across the usual logs
grep -h "$(date '+%b %e %H:%M')" /var/log/syslog /var/log/kern.log /var/log/auth.log

# Package install/remove history around a suspected regression
grep " install \| remove " /var/log/dpkg.log | tail -30
```

## Safety notes

- Deleting a log file a process still has open doesn't free the disk space until that process closes or reopens its file handle (usually via `logrotate`'s `postrotate` restart/reload, or a manual `systemctl reload`) - `truncate -s 0` is safer than `rm` for a log you need to shrink right now.
- `/var/log/auth.log` and `/var/log/secure` can contain usernames typed into the password field by mistake during a failed login - treat their contents as sensitive before pasting them anywhere.
- `logrotate -f` rotates immediately regardless of the configured schedule/size threshold - fine for testing a config, but running it repeatedly in a short window can leave you with many near-empty rotated files.
- A log that suddenly stops updating is itself a symptom - check the service is still running and that its log directory has enough free disk space and correct write permissions, before assuming nothing is happening.
