+++
title = "Linux Server Running Slow Cheat Sheet"
date = 2026-10-07
description = "A systematic triage flow for a slow Linux server: load average, then CPU, memory/swap, disk I/O and network, with the commands and thresholds to tell which one is actually the bottleneck."
tags = ["linux", "performance", "troubleshooting", "sysadmin"]
+++

"The server is slow" isn't a diagnosis, it's a starting point - the goal here is to narrow it down to one of four resources (CPU, memory, disk I/O, network) in the first couple of minutes, using tools already covered in the [Monitoring Tools](/sheets/monitoring-tools-cheat-sheet/), [Process Management](/sheets/process-management-cheat-sheet/), [Disk Check](/sheets/linux-disk-check/) and [Networking Diagnostics](/sheets/networking-diagnostics-cheat-sheet/) cheat sheets, plus a few new ones that only matter for this kind of triage.

## Step 1: load average - is the box actually busy

```bash
uptime             # the three numbers at the end: 1, 5, and 15-minute load averages
cat /proc/loadavg    # same numbers, plus the currently-running/total process count
nproc                   # how many CPU cores this box has - load average means nothing without this
```

```text
Reading the three numbers:
- compare each to nproc, not to a fixed number - a load of 4 is fine on 8 cores, bad on 2
- 1-min number higher than 5-min and 15-min  -> something just started spiking, check right now
- all three climbing together                 -> sustained, ongoing problem
- all three high but climbing down              -> the spike already happened, you're looking at the tail
```

> Load average on Linux counts processes in state `R` (running/runnable) **and** `D` (uninterruptible sleep, usually disk I/O) - a high load average with low CPU usage almost always means disk I/O, not CPU, is the bottleneck. This single fact decides which of the next two sections to check first.

## Step 2: CPU - which processes, and how many cores

```bash
top                       # P sorts by CPU (default) - see Process Management for full key reference
ps aux --sort=-%cpu | head -10   # top 10 CPU consumers as a one-shot snapshot
mpstat -P ALL 1 5             # per-core CPU breakdown, 5 samples 1 second apart (needs sysstat)
vmstat 1 5                      # system-wide CPU/memory/IO summary, same sampling pattern
```

```text
vmstat's cpu columns:
us   time in user space - your actual applications
sy   time in kernel space - syscalls, interrupts, context switching
id   idle - the CPU has nothing to do
wa   waiting on I/O - CPU is idle but blocked on a pending disk/network operation
```

A high `wa` column is the same signal as a high load average with low CPU - it means the bottleneck is downstream of the CPU entirely, usually disk. A single core pegged at 100% while others sit idle (visible with `mpstat -P ALL` or `1` inside `top`) points at a single-threaded process, not a genuine capacity problem - adding more cores won't help that one process.

## Step 3: memory and swap - is the box paging

```bash
free -h                 # total/used/free/available memory and swap, human-readable
vmstat 1 5                 # the si/so columns: swap-in and swap-out, in KB per second
```

```text
vmstat's memory/swap columns:
free   genuinely unused memory - often deceptively low, Linux uses "free" RAM for disk cache
buff/cache   memory the kernel is using for disk cache - reclaimable on demand, not a problem by itself
si / so      KB/sec swapped in / swapped out - anything consistently non-zero here is a real bottleneck
```

Low `free` is normal on a healthy Linux box - the kernel deliberately uses spare RAM as disk cache and drops it instantly when an application needs it back. **Non-zero, sustained `si`/`so` in `vmstat` is the actual red flag** - it means applications are being paged to and from disk, which is orders of magnitude slower than RAM and will make everything feel sluggish. See the [Disk Check sheet's swap section](/sheets/linux-disk-check/#swap-usage) for finding which process is responsible and for swappiness/swapfile controls.

```bash
ps aux --sort=-%mem | head -10    # top 10 memory consumers
dmesg -T | grep -i "out of memory"  # check whether the OOM killer has already stepped in
```

## Step 4: disk I/O - the most common silent culprit

```bash
iostat -xz 1 5     # extended per-device stats, 5 samples 1 second apart (needs sysstat)
iotop -o               # live view, -o shows only processes actually doing I/O right now (needs root)
```

```text
iostat -x key columns:
%util    percentage of time the device was busy servicing requests - sustained near 100% means saturated
await    average time (ms) a request waited, including queueing - the number that actually matches "feels slow"
r/s, w/s     reads and writes per second
```

`%util` at 100% on a spinning disk doing sequential writes can still be healthy; the same number on an SSD, or a high `await` (tens-to-hundreds of ms) on any device, means requests are genuinely queueing up and whatever is waiting on them will feel slow. `iotop -o` turns "disk I/O is high" into "this specific process is causing it" in one step.

```bash
df -h          # out of space entirely? see linux-disk-check - a 100% full filesystem causes its own slowdowns
```

## Step 5: network - ruling it in or out

```bash
ss -s                    # quick socket summary - counts by state, useful for spotting pileups
ss -tn state established | wc -l  # how many established TCP connections right now
ping -c 4 <known-good-host>   # basic latency/loss check - see Networking Diagnostics for the full toolkit
```

A server can be "slow" purely because the network path to or from it is degraded, with CPU/memory/disk all healthy - don't skip this check just because the first four steps looked clean. Full toolkit (ss, mtr, dig, port checks) is in the [Networking Diagnostics Cheat Sheet](/sheets/networking-diagnostics-cheat-sheet/).

## The 60-second triage order

```text
1. uptime                       # load vs nproc - busy at all?
2. vmstat 1 5                     # us/sy/id/wa split tells you CPU vs I/O-wait at a glance
3. free -h                          # swapping?
4. iostat -xz 1 5 or iotop -o          # if wa was high or swap is active, confirm here
5. ss -s / ping                           # only if 1-4 all looked clean
```

Run them in this order, not all at once - each one narrows the search, so there's usually no need to reach step 5 at all.

## Common recipes

```bash
# One-shot snapshot of everything, before it's too late to catch the spike
uptime; free -h; vmstat 1 3; iostat -xz 1 3

# Confirm swapping is the cause of a high load average with idle-looking CPU
vmstat 1 5    # watch the wa and si/so columns together

# Find the single process actually responsible, once a resource is identified
ps aux --sort=-%cpu | head -5     # CPU
ps aux --sort=-%mem | head -5     # memory
iotop -o                              # disk

# Capture a few samples in the background to catch an intermittent spike
nohup vmstat 1 120 > /tmp/vmstat.log &
```

## Safety notes

- `iotop` needs root (it reads kernel I/O accounting that isn't exposed to normal users) - run it with `sudo` or it silently shows nothing useful.
- `mpstat`/`iostat` ship in the `sysstat` package, not installed by default on most minimal images - install it (`apt install sysstat` / `dnf install sysstat`) before an incident, not during one.
- A load average spike that's already past its peak (1-min lower than 5/15-min) means you're debugging history - check `dmesg -T`, cron logs, and application logs for *when* it happened rather than expecting `top` to still show the culprit.
- Don't jump straight to killing the top CPU/memory process - confirm it's actually abnormal for that workload first; killing a legitimate batch job or database checkpoint can cause more damage than the slowdown itself.
