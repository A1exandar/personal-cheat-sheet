+++
title = "journalctl Cheat Sheet"
date = 2026-09-26
description = "Read and filter the systemd journal with journalctl: by service, time range, priority and boot, follow logs live, and manage journal disk usage."
tags = ["linux", "journalctl", "systemd", "logging", "sysadmin"]
+++

`journalctl` reads the systemd journal - the centralized, binary log store that systemd-based distributions use instead of (or alongside) plain text files in `/var/log`. One tool, one query language, for logs from every service, the kernel, and boot itself.

## Viewing the journal

```bash
journalctl              # every log entry, oldest first, piped through a pager
journalctl -e            # jump straight to the end (most recent entries)
journalctl -r             # reverse order - newest first
journalctl --no-pager     # print directly to stdout, skip the pager entirely
```

## Following logs live

```bash
journalctl -f            # follow mode, like tail -f - new entries stream in as they happen
journalctl -fu nginx      # follow just one unit's logs
```

## Filtering by service (unit)

```bash
journalctl -u nginx.service          # only entries from this systemd unit
journalctl -u nginx -u php8.1-fpm    # multiple units at once
```

## Filtering by time

```bash
journalctl --since "2026-09-26 09:00:00"                    # from this exact timestamp onward
journalctl --since "1 hour ago"                               # relative time, human-friendly
journalctl --since today                                      # since midnight
journalctl --since yesterday --until today                    # a full day's range
journalctl --since "2026-09-25" --until "2026-09-26"          # explicit date range
```

## Filtering by priority

```bash
journalctl -p err                # this priority level and everything more severe
journalctl -p warning            # warning and above (warning, err, crit, alert, emerg)
journalctl -p err..crit          # a specific range only
```

Priority levels, from least to most severe: `debug`, `info`, `notice`, `warning`, `err`, `crit`, `alert`, `emerg`. `-p` without a range means "this level or worse", which is usually what you want when hunting for problems.

## Combining filters

```bash
journalctl -u nginx -p err --since "1 hour ago"   # nginx errors in the last hour - the most common real query shape
```

## Filtering by boot

```bash
journalctl -b                # logs from the current boot only
journalctl -b -1              # logs from the previous boot
journalctl --list-boots       # list every boot the journal has recorded, with its index
```

`--list-boots` is the first step when diagnosing a crash or unexpected reboot - it tells you exactly which `-b` index to use for "the boot right before the problem."

## Kernel messages

```bash
journalctl -k          # kernel ring buffer messages only (like dmesg)
journalctl -k -b -1     # kernel messages from the previous boot - useful after a crash
```

## Filtering by process or executable

```bash
journalctl _PID=1234                      # logs from one specific process ID
journalctl /usr/sbin/sshd                  # logs from a specific executable path
journalctl _UID=1000                       # logs from everything run by a specific user ID
```

## Output formats

```bash
journalctl -u nginx -o json-pretty   # structured JSON, one field per line - useful for scripting
journalctl -u nginx -o cat            # message text only, no timestamp/hostname/unit prefix
journalctl -u nginx -o short-iso      # ISO 8601 timestamps instead of the default locale format
```

## Showing more context around a message

```bash
journalctl -u nginx -n 50            # last 50 lines only
journalctl -u nginx -n 50 -f          # last 50 lines, then keep following
```

## Checking disk usage and trimming the journal

```bash
journalctl --disk-usage                    # how much disk space the journal is currently using
sudo journalctl --vacuum-size=500M          # shrink the journal down to at most 500MB
sudo journalctl --vacuum-time=2weeks        # delete entries older than 2 weeks
sudo journalctl --vacuum-files=5            # keep only the 5 most recent journal files
```

> An ever-growing journal is a common cause of a full disk on long-running servers (see the [Server disk full](/labs/wordpress-nginx-troubleshooting-cheat-sheet/#server-disk-full) entry). `--vacuum-size`/`--vacuum-time` are the fast, safe fix; configuring persistent size limits (below) prevents it from recurring.

## Making the journal persistent (and capping its size)

By default on many distributions the journal only lives in `/run/log/journal` - memory-backed, wiped on every reboot.

```bash
sudo mkdir -p /var/log/journal              # creating this directory is what switches storage to disk
sudo systemd-tmpfiles --create --prefix /var/log/journal
sudo systemctl restart systemd-journald
```

```ini
# /etc/systemd/journald.conf
[Journal]
Storage=persistent
SystemMaxUse=500M
```

`SystemMaxUse` caps how much disk space the journal is ever allowed to grow to, so it won't need manual vacuuming later.

## Checking journald's own status

```bash
journalctl --verify           # check the journal files for internal corruption
systemctl status systemd-journald   # is the journal service itself healthy
```

## Common recipes

```bash
# What happened right before the server rebooted unexpectedly?
journalctl -b -1 -p err -n 100

# Tail a specific service's errors live, during a deploy or incident
journalctl -fu nginx -p warning

# Everything a specific user's session logged today
journalctl _UID=1000 --since today

# Export a time-boxed slice of logs to share with someone else
journalctl -u nginx --since "2026-09-26 08:00" --until "2026-09-26 09:00" -o short-iso > nginx-incident.log
```

## Safety notes

- `--vacuum-*` commands delete log data permanently - if you might need those logs later (an audit, an ongoing investigation), export them first with `-o` redirected to a file.
- On a memory-backed (non-persistent) journal, logs are gone after a reboot - if you're troubleshooting something that might require a reboot to fix, capture the relevant logs to a file first.
- `-f` (follow mode) runs until you `Ctrl+C` - fine interactively, but don't leave it running unattended in a script expecting it to exit on its own.
