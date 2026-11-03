+++
title = "Catching Up Missed Jobs with anacron"
date = 2026-11-03
description = "A daily disk report on a RHEL 10 server that's switched off at night, so a cron job at 02:00 never fires: how cron.hourly starts anacron, /etc/cron.daily and run-parts naming rules, a custom /etc/anacrontab line with its own period, timestamps in /var/spool/anacron, RANDOM_DELAY and START_HOURS_RANGE, and testing with anacron -n -d."
tags = ["linux", "rhel", "anacron", "cron", "scheduling", "automation", "rhcsa", "sysadmin"]
+++

**Goal:** a test server is powered off every evening and turned on again in the morning. It needs a disk usage report once a day, and a fuller report every three days. A cron job at 02:00 never runs on this server, because at 02:00 the server is off. anacron runs the job once per period, whenever the server is up.

**How anacron is different from cron:** cron asks "is it 02:00 now?". anacron asks "has this job run in the last *N* days?". If it hasn't, it runs the job now, after a short delay. It doesn't care about the time of day, so it only works for periods measured in days - daily, weekly, monthly or every *N* days.

**Tested on:** RHEL 10.2 with cronie and cronie-anacron 1.7.0. Every command and output below comes from that run. The test system's clock was set to UTC.

## 1. How anacron is started on RHEL

anacron isn't a daemon. Nothing on RHEL runs it from a systemd timer. cron starts it, and it takes three files to see how:

```bash
cat /etc/cron.d/0hourly
```

```text
# Run the hourly jobs
SHELL=/bin/bash
PATH=/sbin:/bin:/usr/sbin:/usr/bin
MAILTO=root
01 * * * * root run-parts /etc/cron.hourly
```

At minute 01 of every hour, cron runs everything in `/etc/cron.hourly/`. One of those is `0anacron`:

```bash
cat /etc/cron.hourly/0anacron
```

```text
#!/usr/bin/sh
# Check whether 0anacron was run today already
if test -r /var/spool/anacron/cron.daily; then
    day=`cat /var/spool/anacron/cron.daily`
fi
if [ `date +%Y%m%d` = "$day" ]; then
    exit 0
fi
...
if [ $online = 0 ]; then
    exit 0
fi

fi
/usr/sbin/anacron -s
```

It exits right away if the daily jobs already ran today, or if the machine is a laptop on battery. Otherwise it starts `anacron -s`. anacron then reads `/etc/anacrontab`:

```bash
cat /etc/anacrontab
```

```text
SHELL=/bin/sh
PATH=/sbin:/bin:/usr/sbin:/usr/bin
MAILTO=root
# the maximal random delay added to the base delay of the jobs
RANDOM_DELAY=45
# the jobs will be started during the following hours only
START_HOURS_RANGE=3-22

#period in days   delay in minutes   job-identifier   command
1	5	cron.daily		nice run-parts /etc/cron.daily
7	25	cron.weekly		nice run-parts /etc/cron.weekly
@monthly 45	cron.monthly		nice run-parts /etc/cron.monthly
```

So on RHEL, `/etc/cron.daily/`, `/etc/cron.weekly/` and `/etc/cron.monthly/` aren't run by cron at a fixed time at all. anacron runs them, once per period, soon after the server comes up: at the next minute 01, plus the job's delay, plus up to `RANDOM_DELAY` minutes - in the worst case almost two hours. That requires `crond` to be running:

```bash
systemctl is-active crond     # active
```

## 2. The easy way - a script in /etc/cron.daily

For a job that should run once a day, drop an executable script into `/etc/cron.daily/`:

```bash
sudo vim /usr/local/bin/disk-report.sh
```

```bash
#!/bin/bash
{ echo "== disk report $(date '+%F %T')"; df -h / | tail -1; } >> /var/log/disk-report.log
```

```bash
sudo chmod 755 /usr/local/bin/disk-report.sh
sudo cp /usr/local/bin/disk-report.sh /etc/cron.daily/disk-report
```

`run-parts` runs every **executable** file in the directory, in alphabetical order. In the test, a copy with mode `644` was silently skipped - no error and no log entry, it just never ran. RHEL's `run-parts` also skips names ending in `~`, `,`, `.rpmsave`, `.rpmorig`, `.rpmnew`, `.swp` and `.cfsaved`, so a backup copy made by an editor doesn't run twice. A `.sh` extension is accepted on RHEL, but a name without one, like `disk-report`, also works on Debian-based systems, whose `run-parts` skips names with dots.

## 3. Your own period - a line in /etc/anacrontab

For the report every three days, add a line to `/etc/anacrontab`:

```bash
echo "3	10	disk-report-3d	/usr/local/bin/disk-report.sh" | sudo tee -a /etc/anacrontab
```

The four fields are:

- `3` - the period in days. `@monthly` is also accepted, as on the `cron.monthly` line.
- `10` - the delay in minutes after anacron starts, before the job runs.
- `disk-report-3d` - the job identifier. anacron uses it in the log and as the name of the timestamp file. It has to be unique.
- the command - the rest of the line.

Check the file before relying on it. A bad line is skipped, and the other jobs still run:

```bash
echo "1 10 broken" | sudo tee -a /etc/anacrontab
sudo anacron -T; echo rc=$?
```

```text
anacron: Invalid syntax in /etc/anacrontab on line 18 - skipping this line
rc=1
```

After removing the bad line, `anacron -T` prints nothing and returns `0`.

## 4. Run it now and look at the timestamps

Waiting for the next hour isn't necessary. `-n` runs due jobs now, without the delays, and `-d` keeps anacron in the foreground and prints what it does:

```bash
sudo anacron -n -d
```

```text
Anacron started on 2026-11-03
Will run job `cron.daily'
Will run job `disk-report-3d'
Will run job `cron.weekly'
Will run job `cron.monthly'
Jobs will be executed sequentially
Job `cron.daily' started
Job `cron.daily' terminated
Job `disk-report-3d' started
Job `disk-report-3d' terminated
Job `cron.weekly' started
Job `cron.weekly' terminated
Job `cron.monthly' started
Job `cron.monthly' terminated
Normal exit (4 jobs run)
```

On this fresh system, all four jobs were due, because none of them had run yet. "Sequentially" means one after the other, never in parallel. After the run, every job has a timestamp file with today's date:

```bash
for f in /var/spool/anacron/*; do echo "$f: $(sudo cat $f)"; done
```

```text
/var/spool/anacron/cron.daily: 20261103
/var/spool/anacron/cron.monthly: 20261103
/var/spool/anacron/cron.weekly: 20261103
/var/spool/anacron/disk-report-3d: 20261103
```

That one date per job is all anacron remembers. A second run on the same day does nothing:

```bash
sudo anacron -n -d
```

```text
Anacron started on 2026-11-03
Normal exit (0 jobs run)
```

## 5. Simulate a missed run - and see the random delay

To test the catch-up, make anacron think the jobs last ran a few days ago by editing the timestamps, then start it the way `0anacron` does, with `-s` and without `-n`:

```bash
echo 20261031 | sudo tee /var/spool/anacron/disk-report-3d
echo 20261102 | sudo tee /var/spool/anacron/cron.daily
sudo anacron -d -s
```

```text
Anacron started on 2026-11-03
Will run job `cron.daily' in 27 min.
Will run job `disk-report-3d' in 32 min.
Jobs will be executed sequentially
```

The delays are the job's own delay plus a random number of minutes up to `RANDOM_DELAY=45`. Here the random part was 22 minutes for both: 5 + 22 = 27 and 10 + 22 = 32. The random delay keeps many servers that boot at the same time - after a power cut, for example - from all running their daily jobs in the same minute.

With the delays shortened for the test (`RANDOM_DELAY=0`, and `1` minute for `cron.daily`), the real path through cron worked end to end. `run-parts /etc/cron.hourly` started `anacron -s`, and the journal showed:

```bash
journalctl -t anacron -o cat | tail -5
```

```text
Anacron started on 2026-11-03
Will run job `cron.daily' in 1 min.
Jobs will be executed sequentially
Job `cron.daily' started
Job `cron.daily' terminated
```

## 6. START_HOURS_RANGE - the hours anacron is allowed to work

`START_HOURS_RANGE=3-22` means anacron only starts jobs between 03:00 and 22:00. Outside that range, it exits without running anything **and without saying why**. With the range changed to `3-5` and the test run at 19:00:

```bash
sudo anacron -d -s
```

```text
Anacron started on 2026-11-03
Normal exit (0 jobs run)
```

The jobs were due, but nothing ran. The same command with `-n` ran them anyway - **`-n` ignores `START_HOURS_RANGE`**, so a manual test with `-n` can succeed while the real runs never happen. Check the range against the hours when the server is actually on. A server that's only up from 23:00 to 02:00 never runs its daily jobs with the default `3-22`.

## Verification

```bash
sudo anacron -T                                  # no output, rc=0
grep disk-report /etc/anacrontab                 # the 3-day line
ls -l /etc/cron.daily/disk-report                # -rwxr-xr-x
sudo cat /var/spool/anacron/cron.daily           # today's date, after the first run
```

After the next morning's boot, once the delay has passed - up to about two hours:

```bash
journalctl -t anacron --since today              # Job `cron.daily' started / terminated
tail -3 /var/log/disk-report.log                 # == disk report <today> ...
```

## Safety notes

- anacron only works in whole days. For "every 6 hours" or "at 02:00 exactly", use cron or a [systemd timer](/labs/systemd-timer-instead-of-cron/). A timer with `Persistent=true` also catches up missed runs, with a precise time.
- Scripts in `/etc/cron.daily/` must be executable. A script without the `x` bit is skipped with no error anywhere.
- `anacron -n` ignores `START_HOURS_RANGE`. Test with `-s` and no `-n` to see what the real hourly run will do.
- anacron runs jobs one after another. A daily job that hangs blocks every job after it, including `cron.weekly` and `cron.monthly`. Give long jobs a `timeout`.
- anacron records the date when it starts a job, whatever the result. A job that fails isn't retried until its next period. Log the result, or watch the output that anacron mails to `MAILTO` - without a mail server, it goes nowhere.
- Don't edit the files in `/var/spool/anacron/` on a production server except to test like in section 5. A wrong date can make a job wait a full period, or run again right away.
