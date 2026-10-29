+++
title = "Replacing a cron Job with a systemd Timer"
date = 2026-10-29
description = "The nightly backup from the cron + rsync lab, moved to a systemd service and timer on RHEL 10: a oneshot service tested on its own first, a calendar schedule checked with systemd-analyze, Persistent=true catching up a run missed while the server was off, OnFailure= alerts instead of MAILTO, and why flock is no longer needed."
tags = ["linux", "rhel", "systemd", "cron", "backup", "sysadmin"]
+++

**Goal:** take the nightly backup job from the [cron and rsync lab](/labs/automating-backups-cron-rsync/) - `/usr/local/bin/backup-example.sh`, run from root's crontab at 02:00 under `flock` - and move it to a systemd service plus timer, without changing the script itself.

**Why bother, when cron already works:** cron starts the job and forgets about it. A systemd timer keeps track of it: every run goes into the journal under one unit name, a failure leaves the unit in a visible `failed` state, a run missed while the server was powered off is caught up at the next boot, and systemd never starts a second copy of a job that's still running. On RHEL, systemd timers are also what the system itself uses for its own scheduled work - `systemctl list-timers` on a fresh install already shows several.

**Tested on:** RHEL 10.2 with systemd 257. Everything below runs as root (or with `sudo`).

## 1. Look at what's being replaced

```bash
sudo crontab -l
```

```text
MAILTO=alex@example.com
0 2 * * *  /usr/bin/flock -n /var/lock/backup-example.lock /usr/local/bin/backup-example.sh
```

Three things are packed into that one line: the schedule (`0 2 * * *`), protection against overlapping runs (`flock -n`), and failure notification (`MAILTO`). Each of them gets its own systemd equivalent below. Leave the cron entry in place for now - it gets removed in section 6, right before the timer is turned on, so there's never a night with no backup and never a night with two.

## 2. Write the service unit

The service describes *what* runs. It doesn't know anything about *when*.

```bash
sudo vim /etc/systemd/system/backup-example.service
```

```ini
[Unit]
Description=Nightly backup of example.com (files + database)
OnFailure=status-alert@%n.service

[Service]
Type=oneshot
User=root
ExecStart=/usr/local/bin/backup-example.sh
Nice=10
IOSchedulingClass=idle
```

- `Type=oneshot` - the script runs to completion and exits; systemd waits for it and treats a non-zero exit code as a failure. This is the right type for any job-style script, as opposed to a long-running daemon.
- `User=root` - looks redundant, since system services run as root anyway. It isn't: see section 3.
- `Nice=10` and `IOSchedulingClass=idle` - the backup gets CPU and disk time only when nothing else needs it, so a long `rsync` doesn't slow down the site it's backing up.
- `OnFailure=` - covered in section 7. The `status-alert@.service` unit it points to doesn't exist yet; that's fine for now.
- There's no `[Install]` section. The service is never enabled on its own - the timer starts it.

## 3. Run the service on its own first

Before any schedule exists, start the service by hand and check that the job actually works under systemd:

```bash
sudo systemctl daemon-reload
sudo systemctl start backup-example.service     # blocks until the script finishes
systemctl status backup-example.service
journalctl -u backup-example.service -n 20
```

After a successful run, `status` shows `Active: inactive (dead)`. For a oneshot service that's the normal result, not a problem: the job finished and exited. While it's still running, the state is `activating`, not `active`.

**The environment is not the same as cron's.** cron sets `HOME`, `LOGNAME` and `SHELL` from root's passwd entry. A system service without `User=` gets no `HOME` at all. Running a test script as a service, first without and then with `User=root`, shows the difference:

```text
start pid=60 HOME=<unset> PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin USER=root
start pid=82 HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin USER=root
```

Anything that looks for its configuration under `~` - `mysqldump` reading credentials from `~/.my.cnf`, `rsync` or `ssh` reading `~/.ssh/config` and keys - can fail under systemd while working fine from cron or a root shell. Setting `User=root` explicitly makes systemd set `HOME=/root`. `PATH` is fixed to the four standard directories, so a script that calls something from `/opt` needs the full path, same as under cron.

## 4. Write the timer unit

The timer describes *when*. By default, `backup-example.timer` starts the service with the same name, `backup-example.service`.

```bash
sudo vim /etc/systemd/system/backup-example.timer
```

```ini
[Unit]
Description=Run backup-example.service every night at 02:00

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true
RandomizedDelaySec=10min

[Install]
WantedBy=timers.target
```

- `OnCalendar=*-*-* 02:00:00` - every day at 02:00, the equivalent of `0 2 * * *`. The format is `weekday year-month-day hour:minute:second`, with `*` meaning "any".
- `Persistent=true` - the timer records when it last ran. If the server was off at 02:00, the backup runs right after the next boot instead of waiting a whole day. Proved in the Verification section.
- `RandomizedDelaySec=10min` - each run starts at a random point between 02:00 and 02:10. With one server, this changes nothing. With fifty servers all backing up to the same storage, it keeps them from hitting it in the same second. Drop it if the job has to start at exactly 02:00.
- `WantedBy=timers.target` - this is what `enable` hooks into, so the timer starts at every boot.

## 5. Check the schedule before trusting it

A wrong `OnCalendar=` doesn't produce an error - the job simply runs at a different time than intended. `systemd-analyze` shows exactly how systemd reads an expression:

```bash
systemd-analyze calendar '*-*-* 02:00:00'
```

```text
Normalized form: *-*-* 02:00:00
    Next elapse: Fri 2026-10-30 02:00:00 CET
       From now: 10h left
```

```bash
systemd-analyze calendar 'Mon..Fri 02:00' --iterations=3     # weekdays only - shows the next three runs
```

```text
  Original form: Mon..Fri 02:00
Normalized form: Mon..Fri *-*-* 02:00:00
    Next elapse: Fri 2026-10-30 02:00:00 CET
       From now: 10h left
   Iteration #2: Mon 2026-11-02 02:00:00 CET
       From now: 3 days left
   Iteration #3: Tue 2026-11-03 02:00:00 CET
       From now: 4 days left
```

Then check both unit files for typos and unknown options:

```bash
systemd-analyze verify /etc/systemd/system/backup-example.service /etc/systemd/system/backup-example.timer
# no output = no problems found
```

## 6. Remove the cron entry, then enable the timer

```bash
sudo crontab -e        # delete the backup-example.sh line, keep anything else
sudo crontab -l        # confirm it's gone
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now backup-example.timer
systemctl list-timers backup-example.timer
```

```text
NEXT                        LEFT LAST PASSED UNIT                 ACTIVATES
Fri 2026-10-30 02:05:35 CET  10h -         - backup-example.timer backup-example.service
```

`NEXT` already includes the random delay (02:05:35, not 02:00). `LAST` stays `-` until the first scheduled run. `enable --now` only starts the *timer* - it doesn't run the backup immediately.

> **Don't skip the crontab cleanup.** The timer and the old cron entry don't know about each other, and the `flock` lock only protects runs that go through `flock`. With both in place, the backup runs twice a night - and the two copies can overlap.

## 7. Get notified on failure - OnFailure= instead of MAILTO

When the service fails, systemd starts the unit named in `OnFailure=`. A template unit (the `@` in the name) lets one alert unit serve every service on the system:

```bash
sudo vim /etc/systemd/system/status-alert@.service
```

```ini
[Unit]
Description=Failure alert for %i

[Service]
Type=oneshot
ExecStart=/usr/bin/logger -p user.err -t status-alert "%i failed - check: journalctl -u %i"
```

In `backup-example.service`, `%n` expands to the full unit name, so a failure starts `status-alert@backup-example.service.service` - the double `.service` looks wrong but is correct: the instance name is `backup-example.service`, and `%i` inside the template expands to that.

`logger` writes the alert into the journal and syslog at error priority, where any log forwarding or monitoring already watching the server picks it up. To get it out of the server directly, add a second `ExecStart=` line - for example `curl -fsS --retry 3 https://hc-ping.com/your-uuid-here/fail` for the health-check service mentioned in the cron lab, or a `mail` command if a mail transport is configured.

Test it by making the backup fail on purpose. The script's `mountpoint -q` guard exits with code 1 when the backup disk isn't mounted:

```bash
sudo umount /backups
sudo systemctl start backup-example.service
```

```text
Job for backup-example.service failed because the control process exited with error code.
See "systemctl status backup-example.service" and "journalctl -xeu backup-example.service" for details.
```

```bash
systemctl list-units --failed                # backup-example.service  loaded failed failed
journalctl -t status-alert                   # the alert written by status-alert@backup-example.service.service
sudo mount /backups                          # put the disk back
sudo systemctl reset-failed backup-example.service
```

The `failed` state stays until the next successful run or a `reset-failed`, so a failure at 02:00 is still visible in `systemctl --failed` when someone logs in hours later. With cron, the only trace would be in a mailbox - if mail was set up at all.

## 8. Why flock isn't needed anymore

systemd runs at most one instance of a unit. If the timer fires - or someone runs `systemctl start` - while the backup is still running, the request is merged into the job that's already in progress, and no second copy starts. Starting the service three times in a row while a slow test run was in progress gave one process and one journal entry, and the third `systemctl start` (without `--no-block`) simply waited about 18 seconds for the running job to finish.

That's what `flock -n` did in the cron version, without a lock file to clean up or forget.

## cron vs. systemd timer - side by side

| | cron | systemd timer |
|---|---|---|
| Schedule | `0 2 * * *` | `OnCalendar=*-*-* 02:00:00` |
| Check the schedule | read it carefully | `systemd-analyze calendar` |
| Overlapping runs | needs `flock` | never - one instance per unit |
| Run missed while powered off | skipped | caught up at boot with `Persistent=true` |
| Output and errors | mail, or a log file the script writes | the journal, under the unit's name |
| Failure | an email, if mail works | `failed` state + `OnFailure=` unit |
| Run it now, exactly as scheduled | copy the command into a root shell | `systemctl start backup-example.service` |
| Next and last run | not shown | `systemctl list-timers` |

cron is still the simpler tool for a one-line job on a box that's always on. The timer earns its two extra files on anything where a missed or silently failed run matters - like a backup.

## Verification - prove it survives a reboot and catches up

```bash
systemctl is-enabled backup-example.timer       # enabled
systemctl list-timers backup-example.timer      # NEXT is tonight, LAST shows the previous run
journalctl -u backup-example.service --since yesterday
ls -l /var/lib/systemd/timers/                  # stamp-backup-example.timer - Persistent=true's record of the last run
```

To see `Persistent=true` work without waiting for 02:00, temporarily switch the timer to run every minute with a drop-in file:

```bash
sudo systemctl edit backup-example.timer
```

```ini
[Timer]
OnCalendar=
OnCalendar=*:*:00
RandomizedDelaySec=0
```

The empty `OnCalendar=` line clears the original schedule - without it, the drop-in adds a second schedule instead of replacing the first. Let one run happen at the full minute, shut the server down before the next one, and boot it again a couple of minutes later:

```bash
journalctl -b -u backup-example.service     # -b: this boot only
```

With `Persistent=true`, a run appears a few seconds after boot - not on a full minute, because it's the catch-up for the run that was missed while the server was off. Repeating the same test with `Persistent=false` gives no run at boot; the next one only happens at the following full minute.

> Stopping and starting just the *timer* (`systemctl stop`, then `start`) isn't a valid test of `Persistent=`: within one boot, systemd remembers the last run in memory and catches up either way. The setting only makes a difference across a reboot, which is the case it exists for.

Remove the test schedule when done:

```bash
sudo systemctl revert backup-example.timer      # deletes the drop-in, back to 02:00
systemctl list-timers backup-example.timer
```

## Safety notes

- Remove the cron entry before enabling the timer - see section 6. Two schedulers running the same backup is worse than either one alone, because the `flock` protection doesn't cover runs started by systemd.
- Run the service by hand with `systemctl start` before relying on the timer. A job that only fails under systemd - usually because of `HOME` or `PATH` - is found in seconds that way, instead of at 02:00.
- `daemon-reload` after every change to a unit file. Without it, systemd keeps using the old version, and `systemctl status` warns that the unit file changed on disk.
- `RandomizedDelaySec=` moves the actual start time. If anything else depends on the backup being finished by a fixed time, leave it out or keep it short.
- `Persistent=true` means a server that was off for the night runs its backup right after boot, at the same time as everything else starting up. With `Nice=10` and `IOSchedulingClass=idle` that's usually harmless, but it's worth knowing before a planned maintenance reboot during working hours.
- The `failed` state and the `OnFailure=` alert only help if someone looks at them. Make sure the alert ends up somewhere that's actually monitored, then test it once with a deliberate failure, as in section 7.
