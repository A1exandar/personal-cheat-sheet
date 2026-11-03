+++
title = "One-time Jobs with at and batch"
date = 2026-11-03
description = "Scheduling a job to run once on RHEL 10 instead of adding a cron line you have to remember to delete: at with clock times and relative times, atq, at -c and atrm, why at -f copies the script, output with no mail server, at.allow and at.deny, jobs that catch up after downtime, and batch waiting for the load average to drop."
tags = ["linux", "rhel", "at", "scheduling", "automation", "rhcsa", "sysadmin"]
+++

**Goal:** run the backup script from the [cron and rsync lab](/labs/automating-backups-cron-rsync/) one extra time tonight at 23:30, before a planned maintenance window, without touching root's crontab. Then do the same kind of one-off job with `batch`, which waits until the server is quiet instead of waiting for a clock time.

**Why not just cron:** cron is for jobs that repeat. A one-off job in a crontab runs again next year if nobody remembers to delete the line - and someone usually doesn't. `at` runs a job once and then forgets it.

**Tested on:** RHEL 10.2 with at 3.2.5. Every command and output below comes from that run. The test system's clock was set to UTC, so the job times below are in UTC. Job numbers depend on what else is in the queue and will differ on another system.

## 1. Install and start atd

```bash
sudo dnf install at
sudo systemctl enable --now atd
systemctl is-active atd
```

```text
active
```

`at` only puts jobs in a queue in `/var/spool/at/`. The `atd` daemon runs them. If `atd` isn't running, `at` still accepts the job and only prints `Can't open /run/atd.pid to signal atd. No atd running?` - and nothing happens at the scheduled time. Section 5 shows what happens when `atd` starts again.

## 2. Schedule the job

`at` reads the commands to run from standard input:

```bash
echo "/usr/local/bin/backup-example.sh >> /var/log/backup-oneoff.log 2>&1" | sudo at 23:30
```

```text
warning: commands will be executed using /bin/sh
job 2 at Tue Nov  3 23:30:00 2026
```

The warning appears every time and isn't an error. On RHEL, `atd` runs the job in the user's login shell from `/etc/passwd`. A test job that printed `$BASH_VERSION` showed `5.2.26(1)-release` for root.

`at` understands many time formats. Each of these was accepted in the test run, at 19:36 on November 3:

| Command | Runs at |
|---|---|
| `at 23:30` | today at 23:30, or tomorrow if 23:30 has already passed |
| `at 2am` | `Wed Nov  4 02:00:00 2026` |
| `at 03:00 tomorrow` | `Wed Nov  4 03:00:00 2026` |
| `at now + 2 hours` | `Tue Nov  3 21:36:00 2026` |
| `at teatime` | `Wed Nov  4 16:00:00 2026` |
| `at noon Dec 24` | `Thu Dec 24 12:00:00 2026` |
| `at 25:00` | refused: `Garbled time` |

**`now + 1 minute` can mean a few seconds.** `at` always rounds down to the start of a minute. Submitted at 19:36:47, `at now + 1 minute` was scheduled for `19:37:00` - 13 seconds later. Don't use short relative times for something that needs a real delay.

## 3. Look at the queue - atq, at -c, atrm

```bash
sudo atq
```

```text
1	Tue Nov  3 19:37:00 2026 a root
2	Tue Nov  3 23:30:00 2026 a root
3	Wed Nov  4 03:00:00 2026 a root
```

The columns are the job number, the time, the queue (`a` for `at`, `b` for `batch`) and the owner. Root sees everyone's jobs.

`at -c` prints the full job exactly as `atd` will run it:

```bash
sudo at -c 1 | head -5
sudo at -c 1 | grep -E "FOO|^cd |HOME"
sudo at -c 1 | tail -4
```

```text
#!/bin/sh
# atrun uid=0 gid=0
# mail root 0
umask 22
PWD=/tmp; export PWD
FOO=bar; export FOO
HOME=/root; export HOME
cd /tmp || {
${SHELL:-/bin/sh} << 'marcinDELIMITER3fa857c1'
/usr/local/bin/backup-example.sh >> /var/log/backup-oneoff.log 2>&1

marcinDELIMITER3fa857c1
```

**`at` saves the environment of the shell you schedule from.** That's the biggest difference from cron and systemd. The job above was scheduled from `/tmp` with `export FOO=bar` set, and the script, when it ran, reported:

```text
backup started 19:37:00 as root in /tmp HOME=/root FOO=bar
```

That's convenient, but it means the same `at` command can behave differently depending on where and how you ran it. For anything important, `cd` to a fixed directory and use full paths inside the job.

To cancel a job, use its number:

```bash
sudo atrm 3
sudo atq
```

```text
1	Tue Nov  3 19:37:00 2026 a root
2	Tue Nov  3 23:30:00 2026 a root
```

## 4. at -f copies the script - it doesn't link to it

`-f` reads the commands from a file instead of standard input:

```bash
sudo at -f /usr/local/bin/backup-example.sh 23:30
sudo at -c 2 | tail -5
```

```text
${SHELL:-/bin/sh} << 'marcinDELIMITER01aae949'
#!/bin/bash
echo "backup started $(date +%T) as $(id -un) in $(pwd) HOME=$HOME FOO=$FOO"

marcinDELIMITER01aae949
```

The script's contents were copied into the job when it was scheduled. If you fix a bug in the script afterwards, the job still runs the old version. The `#!/bin/bash` line is also only a comment here, because the whole thing is fed to the login shell. To run the current version of a script at that time, schedule its path, as in section 2: `echo /usr/local/bin/backup-example.sh | at 23:30`.

## 5. Where the output goes - and what happens after downtime

`atd` mails a job's output to its owner. On a server with no mail server installed, this happens to a job that writes to standard output:

```bash
echo 'echo "output with nowhere to go"; ls /nonexistent' | sudo at now
journalctl -u atd -o cat | tail -2
```

```text
Starting job 8 (a0000801c82b99) for user 'root' (0)
Exec failed for mail command: No such file or directory
```

The output is lost, and only the journal shows that anything went wrong. Redirect output to a log file inside the job, as in section 2, unless you know mail works on that server.

**Missed jobs run as soon as atd starts again.** In the test, `atd` was stopped, a job was scheduled for `19:38:00`, and `atd` was started again at 19:38:50:

```bash
sudo systemctl stop atd
echo 'date +"missed job ran at %T" >> /var/log/missed.log' | sudo at now + 1 minute
# Can't open /run/atd.pid to signal atd. No atd running?
# ... wait until after 19:38 ...
sudo systemctl start atd
cat /var/log/missed.log
```

```text
missed job ran at 19:38:50
```

The job sat in the queue, and `atd` ran it right after starting. The same applies after a reboot: jobs are files in `/var/spool/at/`, so a server that's down at the scheduled time runs them at the next boot - late, but not lost. Keep that in mind for jobs that only make sense at one specific time.

## 6. Who's allowed to use at

Two files control access:

- If `/etc/at.allow` exists, **only** the users listed in it can use `at`.
- If it doesn't exist, everyone can, **except** the users in `/etc/at.deny`.

RHEL ships an empty `/etc/at.deny` and no `at.allow`, so every user can schedule jobs. Tested with three users:

```bash
echo bob | sudo tee -a /etc/at.deny
sudo -u bob bash -c 'echo true | at now + 5 minutes'
```

```text
You do not have permission to use at.
```

```bash
echo alex | sudo tee /etc/at.allow
sudo -u carol bash -c 'echo true | at now + 5 minutes'
```

```text
You do not have permission to use at.
```

With `at.allow` in place, `carol` was refused even though that user isn't in `at.deny` - `at.deny` isn't checked at all once `at.allow` exists. Root can always use `at`.

## 7. batch - run it when the server is quiet

`batch` takes a job the same way as `at`, but without a time. `atd` starts it as soon as the load average drops below 0.8:

```bash
echo '/usr/local/bin/backup-example.sh >> /var/log/backup-oneoff.log 2>&1' | sudo batch
sudo atq
```

```text
job 12 at Tue Nov  3 19:40:00 2026
12	Tue Nov  3 19:40:00 2026 b root
```

To see it wait, the test system was kept busy with four CPU loops, and a batch job that records the time and the load when it starts was submitted at a load of 2.85. Then the loops stopped:

```text
19:40:45 load 3.30 ran:
19:41:15 load 3.58 ran:
19:41:45 load 3.13 ran:
19:42:15 load 1.90 ran:
19:42:45 load 1.15 ran:
19:43:15 load 0.69 ran: batch job ran at 19:43:15, load 0.75
```

The job waited three minutes, until the load fell under the limit. The queue column shows `b` while a batch job waits, and `=` while it runs.

**0.8 is low for a modern server.** The load average counts every CPU, so a server with 8 cores at 25% load already has a load average around 2 and never runs batch jobs. Raise the limit in `/etc/sysconfig/atd` - the file's own comment suggests a value above *number of CPUs - 1*:

```bash
# /etc/sysconfig/atd
OPTS="-l 4"
```

```bash
sudo systemctl restart atd
```

## Verification

```bash
systemctl is-active atd                 # active
sudo atq                                # job 2 at 23:30, queue a, root
sudo at -c 2 | tail -3                  # the exact commands that will run
```

After 23:30:

```bash
sudo atq                                # job 2 is gone
tail /var/log/backup-oneoff.log         # the backup's output
journalctl -u atd --since today         # Starting job 2 ... for user 'root'
```

## Safety notes

- `at` saves the current directory and environment. Schedule important jobs from a known state, or set everything they need inside the job.
- `at -f` copies the script's contents when the job is scheduled. Edits made later don't apply. Schedule the script's path instead.
- Without a working mail server, output that isn't redirected is lost. Always send it to a log file.
- Jobs whose time passed while `atd` or the server was down run as soon as `atd` starts. A job like "restart the service at 03:00, during the maintenance window" would run in the middle of the day after an outage - check `atq` after unplanned downtime.
- With the default limit of 0.8, `batch` jobs on a busy multi-core server may wait forever. Set `-l` in `/etc/sysconfig/atd` to fit the CPU count.
- For a one-off job that needs systemd's logging and resource limits, see [systemd-run](/labs/systemd-run-transient-jobs/). For jobs that repeat, use cron or a [systemd timer](/labs/systemd-timer-instead-of-cron/).
