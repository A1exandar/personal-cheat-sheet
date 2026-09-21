+++
title = "Crontab Cheat Sheet"
date = 2026-09-02
description = "Schedule recurring jobs with cron: crontab syntax, time expressions, special values, logging, MAILTO and safe locking with flock."
tags = ["linux", "cron", "automation", "sysadmin"]
+++

A quick reference for scheduling recurring tasks with cron on Linux.

## What cron is

`cron` is a daemon that runs commands on a schedule. There are two places schedules live:

- **User crontab** — one per user, edited with `crontab -e`, stored under `/var/spool/cron/` (or `/var/spool/cron/crontabs/`). Jobs run as that user. No username field.
- **System-wide cron** — `/etc/crontab` and the files in `/etc/cron.d/`, plus the directories `/etc/cron.daily/`, `/etc/cron.hourly/`, `/etc/cron.weekly/` and `/etc/cron.monthly/`. These files have an **extra field for the user** the job runs as, and are usually managed by packages or configuration management.

Use a user crontab for personal or service-account jobs; use `/etc/cron.d/` for jobs deployed as part of system configuration.

## Open, list, edit and remove a user crontab

```bash
crontab -e          # open your crontab in $EDITOR
crontab -l          # print your crontab
crontab -r          # delete your crontab entirely
crontab -l -u www-data   # view another user's crontab (needs root)
```

> `crontab -r` removes the whole crontab immediately, with no confirmation. It is easy to hit by accident next to `-e`. Back up first with `crontab -l > ~/crontab.bak`, and prefer `crontab -e` to delete individual lines.

## Cron expression structure

```text
* * * * *  command to run
│ │ │ │ │
│ │ │ │ └─ day of week  (0-7, both 0 and 7 = Sunday; names sun-sat allowed)
│ │ │ └─── month        (1-12; names jan-dec allowed)
│ │ └───── day of month (1-31)
│ └─────── hour         (0-23)
└───────── minute       (0-59)
```

## Special characters

- `*` — every value in the field.
- `,` — a list, e.g. `0,15,30,45`.
- `-` — an inclusive range, e.g. `1-5`.
- `/` — a step, e.g. `*/10` (every 10) or `0-30/5` (every 5 within 0–30).

## Special values

| Value | Meaning |
|---|---|
| `@reboot` | Once, after the system boots |
| `@yearly` / `@annually` | `0 0 1 1 *` |
| `@monthly` | `0 0 1 * *` |
| `@weekly` | `0 0 * * 0` |
| `@daily` / `@midnight` | `0 0 * * *` |
| `@hourly` | `0 * * * *` |

```cron
@daily   /usr/local/bin/cleanup.sh      # runs once a day, at midnight
@reboot  /usr/local/bin/warm-cache.sh   # runs once, right after boot
```

## Common schedules

```cron
# Every day at 02:30
30 2 * * *      /usr/local/bin/backup.sh

# Every day, every 4 hours (00:00, 04:00, 08:00, ...)
0 */4 * * *     /usr/local/bin/sync.sh

# Every hour, on the hour
0 * * * *       /usr/local/bin/poll.sh

# Every 5 / 10 / 15 / 30 minutes
*/5 * * * *     /usr/local/bin/metrics.sh
*/10 * * * *    /usr/local/bin/metrics.sh
*/15 * * * *    /usr/local/bin/metrics.sh
*/30 * * * *    /usr/local/bin/metrics.sh

# Every Monday at 06:00
0 6 * * 1       /usr/local/bin/weekly-report.sh

# Weekdays (Mon-Fri) at 09:00
0 9 * * 1-5     /usr/local/bin/workday.sh

# Weekends (Sat and Sun) at 10:00
0 10 * * 6,0    /usr/local/bin/weekend.sh

# First day of the month at 00:05
5 0 1 * *       /usr/local/bin/monthly-invoice.sh
```

### Last day of the month

Cron has no "last day" token. The day-of-month field is fixed, so the usual approach is to run every day and let the script exit unless tomorrow is the 1st:

```cron
5 0 28-31 * *  [ "$(date -d tomorrow +\%d)" = "01" ] && /usr/local/bin/month-end.sh   # only actually runs on the month's last day
```

Note that `%` must be escaped as `\%` inside a crontab line. Restricting to `28-31` just avoids waking the job early in the month.

### Every two months

```cron
# 03:00 on the 1st of Jan, Mar, May, Jul, Sep, Nov
0 3 1 1,3,5,7,9,11 *   /usr/local/bin/bimonthly.sh
```

### Every other week

Classic cron has **no reliable built-in "every other week"** — `*/2` on the day-of-week field does not track calendar weeks. Run the job weekly and gate it on the ISO week number:

```cron
# Every Monday at 07:00, but only on even ISO weeks
0 7 * * 1  [ $(( $(date +\%V) \% 2 )) -eq 0 ] && /usr/local/bin/biweekly.sh
```

For anything more complex, move the "should I run today" decision into the script, or use a systemd timer with `OnCalendar` plus a persistent state file.

### On server restart

```cron
@reboot  /usr/local/bin/on-boot.sh   # runs once, right after the system boots
```

## Redirecting output to a log file

By default cron mails any output to the job's owner. Redirect it instead:

```cron
30 2 * * *  /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1   # append stdout+stderr to a log file
```

`>>` appends stdout; `2>&1` sends stderr to the same place. Use `> /var/log/backup.log 2>&1` to overwrite each run, or `> /dev/null 2>&1` to discard everything (you then lose all error visibility).

## Mail from cron and MAILTO

```cron
MAILTO="admin@example.com"   # send any job output on this crontab to this address
0 3 * * *  /usr/local/bin/backup.sh
```

Any output the job produces is emailed to `MAILTO`. `MAILTO=""` disables mail for the jobs below it.

> This requires a working local mail system (for example Postfix or `msmtp`) that can actually deliver. On a bare server with no MTA, the mail is silently dropped — redirect to a log file instead.

## Why cron's environment is limited

Cron jobs run with a minimal environment: a short `PATH` (often just `/usr/bin:/bin`), no profile, and `HOME` set but little else. A command that works in your shell can fail under cron because a binary is not on cron's `PATH`.

- Always use **absolute paths** for commands and files: `/usr/bin/rsync`, not `rsync`.
- Set what you need explicitly at the top of the crontab:

```cron
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin   # explicit PATH, cron's default is minimal
SHELL=/bin/bash                                                      # explicit shell, don't rely on the default
```

## Checking the cron service (systemd)

The package and service name differ by distribution:

```bash
# Debian / Ubuntu
systemctl status cron

# RHEL / CentOS / Fedora / SUSE
systemctl status crond
```

## Where to find cron logs

```bash
# systemd journal (most distributions)
journalctl -u cron          # or -u crond
journalctl -u cron --since "1 hour ago"

# Debian/Ubuntu with rsyslog
grep CRON /var/log/syslog

# RHEL family
grep CRON /var/log/cron
```

The log shows when cron *started* a job, not its output — that still goes to mail or your redirect.

## Testing and troubleshooting

- Run the exact command by hand first, then again with a stripped environment: `env -i /bin/bash -c '/usr/local/bin/backup.sh'`.
- Temporarily schedule it for one or two minutes ahead and watch the log.
- Add logging inside the script (`date`, `set -x`) so you can see how far it got.
- Check that the crontab file ends with a newline — some cron implementations skip the last line otherwise.
- Confirm the job owner has permission to run the command and write any output paths.

## Safety notes

**Script permissions.** Keep job scripts owned by root (or the service account) and not writable by others, since cron runs them with that account's privileges:

```bash
sudo chown root:root /usr/local/bin/backup.sh   # owned by root, not a regular user account
sudo chmod 750 /usr/local/bin/backup.sh          # owner rwx, group rx, others nothing
```

**Avoid overlapping runs.** If a job can take longer than its interval, two copies may run at once and corrupt data or thrash the disk. Wrap it in `flock` so a second start exits immediately:

```cron
*/10 * * * *  /usr/bin/flock -n /var/lock/backup.lock /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1   # skip this run if the lock is already held
```

`-n` means "fail now if the lock is held". Use `-w 60` instead to wait up to 60 seconds for the lock.
