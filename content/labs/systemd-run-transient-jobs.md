+++
title = "Ad-hoc Timers and One-off Jobs with systemd-run"
date = 2026-11-03
description = "Running a job later, or right now, as a real systemd unit without writing a unit file: --on-active and --on-calendar timers, why a 10-second timer fired 44 seconds late, the environment systemd-run doesn't pass on, --wait and --pipe for exit codes and output, MemoryMax= and CPUQuota= limits on a single command, cancelling, and why transient timers don't survive a reboot."
tags = ["linux", "rhel", "systemd", "systemd-run", "scheduling", "automation", "sysadmin"]
+++

**Goal:** run the backup script from the [cron and rsync lab](/labs/automating-backups-cron-rsync/) once more - in a few minutes, or tonight at 03:00 - with systemd's logging and resource limits, but without writing a `.service` and `.timer` file that you would have to delete afterwards. Then use the same tool to run a single command under a memory or CPU limit.

**What systemd-run does:** it creates a *transient* unit - a service, and optionally a timer for it - directly through the systemd API. The unit works like one from a file: it shows up in `systemctl` and `list-timers`, writes to the journal under its own name, and takes the same `[Service]` properties. When the job finishes, the unit disappears. Nothing is left in `/etc/systemd/system/`.

**Tested on:** RHEL 10.2 with systemd 257. Everything below runs as root (or with `sudo`), and every command and output comes from that run. The test system's clock was set to UTC.

## 1. A job in ten seconds - and why it ran late

```bash
sudo systemd-run --on-active=10s /usr/local/bin/backup-example.sh
```

```text
Running timer as unit: run-p431-i6094.timer
Will run service as unit: run-p431-i6094.service
```

```bash
systemctl list-timers --all | grep -E "NEXT|run-"
```

```text
NEXT                         LEFT LAST PASSED UNIT                         ACTIVATES
Tue 2026-11-03 19:46:18 UTC    9s -         - run-p431-i6094.timer         run-p431-i6094.service
```

The timer was created at 19:46:08, and `NEXT` shows 19:46:18. The journal shows when the job really started:

```bash
journalctl -o short-precise -u 'run-p431-i6094.*'
```

```text
Nov 03 19:46:52.168559 systemd[1]: Started run-p431-i6094.service - [systemd-run] /usr/local/bin/backup-example.sh.
Nov 03 19:46:52.193148 backup-example.sh[441]: backup started 19:46:52 as root in / HOME=<unset> FOO=<unset>
Nov 03 19:46:54.200627 backup-example.sh[441]: backup finished
Nov 03 19:46:54.201986 systemd[1]: run-p431-i6094.service: Deactivated successfully.
Nov 03 19:46:54.202707 systemd[1]: run-p431-i6094.timer: Deactivated successfully.
```

**It started 44 seconds late.** Every systemd timer has `AccuracySec=1min` by default: systemd may delay it by up to a minute so it can wake up once for several timers instead of separately for each. For a nightly job that doesn't matter. For "in ten seconds", set the accuracy yourself with `--timer-property=`:

```bash
sudo systemd-run --unit=acc --on-active=10s --timer-property=AccuracySec=1s /usr/local/bin/backup-example.sh
```

Started at 19:47:37, the job ran at `19:47:48`.

After the run, the timer and the service were gone - `systemctl list-units --all 'run-*'` didn't show them anymore. The journal entries stay, under the unit name.

## 2. The environment isn't passed on

The second log line above says `in /`, `HOME=<unset>` and `FOO=<unset>`. The job was started from `/tmp`, in a shell with `export FOO=bar`. Unlike [at](/labs/one-time-jobs-at-batch/), which saves the whole shell environment, `systemd-run` starts the unit from systemd, with the same minimal environment as any other service. Pass what the job needs explicitly:

```bash
cd /tmp; export FOO=bar
sudo systemd-run --unit=acc --on-active=10s --timer-property=AccuracySec=1s \
    -E FOO=bar --same-dir --uid=root /usr/local/bin/backup-example.sh
journalctl -u acc.service -o cat | grep backup
```

```text
backup started 19:47:48 as root in /tmp HOME=/root FOO=bar
backup finished
```

- `-E NAME=value` - sets one environment variable. Repeat it for each one.
- `--same-dir` - runs the job in the current directory instead of `/`.
- `--uid=root` - looks redundant for a job that already runs as root, but it also sets `HOME`. The [systemd timer lab](/labs/systemd-timer-instead-of-cron/) has the same effect with `User=root`.

## 3. A named job at a fixed time - and cancelling it

`--unit=` gives the timer and the service a name you can find again. `--on-calendar=` takes the same time format as `OnCalendar=` in a timer file:

```bash
sudo systemd-run --unit=backup-oneoff --on-calendar="2026-11-04 03:00" /usr/local/bin/backup-example.sh
systemctl list-timers | grep -E "NEXT|backup-oneoff"
```

```text
Running timer as unit: backup-oneoff.timer
Will run service as unit: backup-oneoff.service
NEXT                         LEFT LAST PASSED UNIT                         ACTIVATES
Wed 2026-11-04 03:00:00 UTC    7h -         - backup-oneoff.timer          backup-oneoff.service
```

The generated units can be inspected like any other:

```bash
systemctl cat backup-oneoff.timer
```

```text
# /run/systemd/transient/backup-oneoff.timer
# This is a transient unit file, created programmatically via the systemd API. Do not edit.
[Unit]
Description=[systemd-run] /usr/local/bin/backup-example.sh

[Timer]
OnCalendar=2026-11-04 03:00
RemainAfterElapse=no
```

They live in `/run/systemd/transient/` - in `/run`, which is a tmpfs. To cancel the job before it runs, stop the timer:

```bash
sudo systemctl stop backup-oneoff.timer
systemctl list-timers --all | grep -c backup-oneoff
```

```text
0
```

A repeating schedule like `--on-calendar="*-*-* 02:00"` also works and runs every night - until the next reboot.

## 4. Transient means gone after a reboot

Two transient timers were created, for 02:00 every night and for November 5 at 03:00. Two `at` jobs were in the queue as well. Then the system was restarted:

```bash
systemctl list-timers --all | grep -cE "survive|nightly"
ls /run/systemd/transient/
atq
```

```text
0
ls: cannot access '/run/systemd/transient/': No such file or directory
2	Tue Nov  3 23:30:00 2026 a root
3	Wed Nov  4 03:00:00 2026 a root
```

Both timers were gone, and nothing warned about it. The `at` jobs survived, because they're files in `/var/spool/at/`. That's the main difference between the two:

| | `at` | `systemd-run --on-calendar` |
|---|---|---|
| Survives a reboot | yes | **no** |
| Job missed during downtime | runs at the next boot | lost |
| Environment | the shell's, saved | minimal, set with `-E` |
| Output | mail, or lost without a mail server | the journal, under the unit name |
| Resource limits | none | any `[Service]` property, with `-p` |

Use `systemd-run` for jobs within the current boot, and `at` or a timer file for anything that has to happen after a possible reboot.

## 5. Run it now - `--wait` and `--pipe`

Without a timer option, `systemd-run` starts the service right away and returns immediately. To wait for the job and get its exit code, add `--wait`:

```bash
sudo systemd-run --wait -q /bin/bash -c 'exit 3'; echo rc=$?
```

```text
rc=3
```

Without `-q`, `--wait` also prints a summary when the job ends:

```text
Running as unit: run-p469-i2159.service; invocation ID: f963ae8d9cb64add900c4035e5c105b7
Finished with result: success
Main processes terminated with: code=exited, status=0/SUCCESS
Service runtime: 10ms
CPU time consumed: 3ms
Memory peak: 1.2M (swap: 0B)
```

The job's own output still goes to the journal. To see it in the terminal, use `--pipe` (`-P`) instead, which connects the job's standard input and output to the terminal and also waits:

```bash
sudo systemd-run -q -P /bin/bash -c 'echo hi from the unit'
```

```text
hi from the unit
```

**A failed transient service stays around.** A successful one disappears, but one that fails stays in the `failed` state until you clear it:

```bash
sudo systemd-run -q --unit=failjob /bin/false
systemctl list-units --failed | grep failjob
```

```text
● failjob.service        loaded failed failed [systemd-run] /bin/false
```

That's useful for finding out what went wrong. Clear it with `systemctl reset-failed failjob.service`, or start the job with `--collect` (`-G`), which removes the unit even after a failure.

## 6. Limits for a single command

Any `[Service]` property can be set with `-p`. That makes `systemd-run` a quick way to run one command with a hard memory limit - here, a Python one-liner that tries to allocate 200 MiB under a 50 MiB limit:

```bash
sudo systemd-run --wait -p MemoryMax=50M -p MemorySwapMax=0 \
    /usr/bin/python3 -c 'b=bytearray(200*1024*1024)'
```

```text
Running as unit: run-p512-i2213.service; invocation ID: 081d4a108afd4079a22dcc05208cc394
Finished with result: oom-kill
Main processes terminated with: code=killed, status=9/KILL
```

The kernel killed only this process when it reached 50 MiB, and the rest of the system wasn't affected. `MemorySwapMax=0` matters: without it, the process could keep going in swap instead of being stopped.

A CPU limit works the same way. A loop that would keep one CPU busy for 5 seconds, limited to 20%:

```bash
sudo systemd-run --wait -p CPUQuota=20% /bin/bash -c 'timeout 5 sh -c "while :; do :; done"; true'
```

```text
Service runtime: 5.008s
CPU time consumed: 1.015s
```

In 5 seconds of runtime, it got 1 second of CPU time - 20%. The same works for a heavy one-off job on a production server: `-p CPUQuota=50% -p IOSchedulingClass=idle` in front of a big `rsync` or `tar` keeps it from slowing everything else down.

For an interactive command, `--scope` runs it in the current terminal, in its own cgroup with those limits:

```bash
sudo systemd-run --scope -q -p MemoryMax=100M /bin/bash -c 'cat /proc/self/cgroup'
```

```text
0::/system.slice/run-p495-i2177.scope
```

## Verification

```bash
sudo systemd-run --unit=check --on-active=30s --timer-property=AccuracySec=1s /usr/local/bin/backup-example.sh
systemctl list-timers check.timer               # NEXT in about 30s
sleep 35
journalctl -u check.service -o cat              # backup started ... / backup finished
systemctl list-units --all 'check*'             # 0 loaded units - cleaned up after success
```

## Safety notes

- Transient timers are lost on reboot, with no warning and no catch-up. Don't use `systemd-run` for a job that must happen after a possible restart - use `at`, or write a timer file.
- The default timer accuracy is one minute. Short `--on-active` times can run up to a minute late unless you set `--timer-property=AccuracySec=1s`.
- `systemd-run` doesn't pass on the current directory or environment. Use `-E`, `--same-dir` and `--uid=` for what the job needs.
- Without `--wait` or `--pipe`, `systemd-run` returns `0` as soon as the unit has started, even if the job then fails. Scripts that check the result need `--wait`.
- Give scheduled jobs a `--unit=` name. `run-p431-i6094` is hard to find in `list-timers` and the journal the next morning.
- `MemoryMax=` without `MemorySwapMax=0` can let a process slow the system down in swap instead of being stopped at the limit.
