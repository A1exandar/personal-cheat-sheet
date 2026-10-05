+++
title = "Process Management Cheat Sheet"
date = 2026-10-05
description = "Inspect and control Linux processes with ps, top, kill/pkill, nice/renice and /proc: process states, signals, priority, process trees and job control."
tags = ["linux", "processes", "sysadmin"]
+++

Finding, inspecting, prioritizing and stopping processes - the other half of system monitoring, alongside the live dashboards already covered in the [Open Source Monitoring Tools Cheat Sheet](/sheets/monitoring-tools-cheat-sheet/) (`htop`, `glances`).

## ps - a snapshot of running processes

```bash
ps aux                    # every process, BSD-style: user, pid, %cpu, %mem, command
ps -ef                      # every process, UNIX-style: includes parent PID (PPID)
ps -u alex                   # only processes owned by this user
ps -p 1234                     # only this specific PID
```

```bash
ps aux --sort=-%cpu | head -10   # top 10 processes by CPU usage
ps aux --sort=-%mem | head -10     # top 10 processes by memory usage
ps -eo pid,ppid,cmd,%cpu,%mem      # pick exactly the columns you want
```

`ps` is a single snapshot, not a live view - run it again (or pipe through `watch`) to see how things change: `watch -n 2 'ps aux --sort=-%cpu | head'`.

## top - the classic live view

```bash
top          # live-updating process list, sorted by CPU by default
```

```text
inside top:
P    sort by CPU usage (default)
M    sort by memory usage
k    kill a process - prompts for a PID, then a signal
r    renice a process - prompts for a PID, then a new priority
1    toggle showing each CPU core separately instead of one combined average
q    quit
```

`top` ships on essentially every Linux system with no install step - `htop` (covered in the monitoring sheet) is friendlier, but `top` is the one guaranteed to already be there on any box you SSH into.

## Process states

```text
R   Running or runnable (on the run queue)
S   Sleeping - waiting for an event (the most common state for an idle process)
D   Uninterruptible sleep - usually waiting on disk I/O, can't even be killed with -9 while in this state
T   Stopped - paused, usually by a signal (Ctrl+Z) or being traced
Z   Zombie - finished, but its exit status hasn't been collected by its parent yet
```

```bash
ps aux | awk '$8 ~ /^Z/ {print}'   # find zombie processes (state column starts with Z)
```

A zombie can't be killed directly - it's already dead, just waiting for its parent to call `wait()`. A pile of zombies means the *parent* process has a bug; fixing or restarting the parent clears them.

## Sending signals: kill, pkill, killall

```bash
kill 1234                # send SIGTERM (15) - ask the process to shut down gracefully
kill -9 1234                # send SIGKILL (9) - the kernel terminates it immediately, no cleanup
kill -l                        # list every signal name and number
```

```bash
pkill nginx                  # send SIGTERM to every process matching the name "nginx"
pkill -9 -u alex                # SIGKILL every process owned by user alex
killall firefox                   # send SIGTERM to every process named exactly "firefox"
```

```text
Common signals:
1   SIGHUP    often means "reload config" for daemons, historically "terminal hung up"
2   SIGINT    what Ctrl+C sends - interrupt
9   SIGKILL   immediate termination, cannot be caught, blocked, or ignored
15  SIGTERM   the default - graceful shutdown, the process can catch this and clean up
18  SIGCONT   resume a stopped process
19  SIGSTOP   pause a process, cannot be caught, blocked, or ignored
```

`kill` is a poor name for what it does - it *sends a signal*, and SIGTERM (the default) is a polite request, not a kill shot. Always try the default signal first; reach for `-9` only once a plain `kill`/`pkill` hasn't worked after a few seconds.

## nice and renice - process priority

```bash
nice -n 10 ./backup.sh        # start a new process with lower priority (higher niceness = less CPU priority)
nice -n -5 ./critical-job         # start with higher priority - needs root for negative values
```

```bash
renice -n 15 -p 1234        # lower the priority of an already-running process
renice -n -5 -p 1234           # raise it - needs root for negative values
ps -o pid,ni,cmd -p 1234          # check a process's current niceness (the "NI" column)
```

Niceness ranges from `-20` (highest priority) to `19` (lowest) - the name comes from "how nice this process is being to everyone else," so a *higher* number means it yields the CPU more readily, not that it runs faster.

## Inspecting a process through /proc

```bash
ls /proc/1234/                      # everything the kernel exposes about this PID
cat /proc/1234/status                 # human-readable summary: state, memory, threads, signals
cat /proc/1234/cmdline                  # the exact command line it was started with
ls -l /proc/1234/exe                      # symlink to the actual executable on disk
ls -l /proc/1234/cwd                        # symlink to its current working directory
ls -l /proc/1234/fd/                          # every file descriptor (open file, socket, pipe) it holds
```

Every number under `/proc` is a running process's PID - `/proc` isn't just for inspection, it's the actual data source `ps`, `top`, and `kill` all read from and act on.

## Process trees

```bash
pstree                     # every process as a tree, showing parent/child relationships
pstree -p                    # same, with PIDs shown
pstree -p 1234                 # just the tree rooted at this PID and its descendants
ps -ef --forest                  # ps's own tree view, if pstree isn't installed
```

Useful for answering "what actually launched this process" or "will killing this take its children down with it" before you `kill` something with dependents.

## Job control: background, foreground, and surviving logout

```bash
./long-task.sh &         # start a command in the background immediately
Ctrl+Z                      # suspend the current foreground job
jobs                          # list jobs in the current shell session
fg %1                           # bring job 1 back to the foreground
bg %1                             # resume a suspended job 1, but in the background
```

```bash
nohup ./long-task.sh &      # keep running even after the terminal/SSH session closes
disown %1                     # detach an already-running background job from this shell
setsid ./long-task.sh &          # fully detach into a new session, immune to the shell's own signals
```

`nohup` alone still leaves the process as a child of your shell - closing the terminal can still send SIGHUP to it on some systems. `disown` (after backgrounding) or `setsid` (from the start) are more thorough if the job genuinely needs to outlive the session; for anything that should survive a reboot too, a proper `systemd` service unit is the real answer, not a background job.

## Common recipes

```bash
# What's using the most CPU right now?
ps aux --sort=-%cpu | head -5

# Find and gracefully stop every process matching a name
pkill -f "python manage.py runserver"

# A process won't die with a normal kill - escalate
kill 1234; sleep 3; kill -9 1234

# Find what's holding a specific port open, then kill it
ss -tlnp | grep :8080
kill $(lsof -t -i :8080)

# See exactly what a mystery PID actually is
cat /proc/1234/cmdline | tr '\0' ' '; echo
ls -l /proc/1234/exe
```

## Safety notes

- Reach for `kill -9` only after a plain `kill`/`pkill` has failed - SIGKILL gives the process no chance to flush buffers, release locks, or clean up temp files, which can corrupt data for anything mid-write.
- `pkill`/`killall` match by name or pattern across **every matching process on the system**, not just the one you're thinking of - double-check with `pkill -l` (list mode, doesn't actually send a signal) or `ps aux | grep` before running the real command, especially as root.
- A process stuck in `D` (uninterruptible sleep) can't be killed at all, even with `-9` - it's waiting on the kernel/hardware (often disk I/O), and will stay stuck until that I/O completes or the underlying device issue is resolved.
- Negative niceness (higher priority) requires root - a misbehaving high-priority process can starve everything else on the box of CPU, so reserve it for processes that have genuinely earned it.
