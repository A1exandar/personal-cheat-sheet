+++
title = "Linux Disk & Filesystem Check"
date = 2026-08-29
description = "Check disk usage, partitions and mounted filesystems with df, du, lsblk, mount, fdisk and blkid, plus swap usage - which processes eat the most swap, and how to control it."
tags = ["linux", "filesystem", "storage", "memory", "sysadmin"]
+++

A quick reference for inspecting disk space, block devices, partitions and mounted filesystems.

## df -h

Shows free and used space per mounted filesystem in human-readable units.

```bash
df -h
df -h /var
df -hT
```

Use it when a service fails to write, a deploy runs out of space, or you need a fast overview of every mount. `df -hT` adds the filesystem type column; `df -i` reports inode usage, which can run out even when space is free.

## du -sh *

Summarises how much space each file or directory consumes.

```bash
du -sh *
du -sh /var/log
du -sh * | sort -h
du -h --max-depth=1 /var | sort -h
```

Use it after `df` reports a full disk, to find *what* is filling it. `du` walks the directory tree and adds up file sizes, so it can be slow on large paths.

## lsblk

Lists block devices (disks, partitions, LVM volumes) as a tree, with size and mount point.

```bash
lsblk
lsblk -f
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT,MODEL
```

Use it to see which disks exist, how they are partitioned, and what is mounted where. `lsblk -f` adds filesystem type, label and UUID. It reads from the kernel and needs no root.

## mount

With no arguments, lists everything currently mounted and the options in effect.

```bash
mount
mount | column -t
findmnt
findmnt /var
```

Use it to confirm a filesystem is mounted read-write, check mount options (`noexec`, `nosuid`, `ro`), or verify a network share is attached. `findmnt` is a more readable modern alternative.

## fdisk -l

Lists disks and their partition tables. Needs root.

```bash
sudo fdisk -l
sudo fdisk -l /dev/sda
```

Use it to inspect partition layout, sizes and types on MBR and GPT disks, typically before partitioning a new disk or diagnosing a disk that is not showing up as expected. `parted -l` gives similar output and handles large GPT disks well.

## blkid

Prints the UUID, label and filesystem type of block devices.

```bash
sudo blkid
sudo blkid /dev/sda1
```

Use it when editing `/etc/fstab`, since mounting by `UUID=` is more reliable than by `/dev/sdX`, which can change between boots.

## df vs du vs lsblk

- **`df`** asks each *mounted filesystem* how much space it reports as used and free. Fast, filesystem-level view.
- **`du`** adds up the sizes of *files* under a path. Slower, answers "what is using the space".
- **`lsblk`** shows the *block devices* themselves (disks and partitions) and their mount points, regardless of usage.

A classic discrepancy: `df` shows a disk as full but `du` on the same filesystem finds far less. That usually means a deleted file is still held open by a running process:

```bash
sudo lsof +L1
```

## Swap usage

Swap is disk-backed virtual memory - worth checking alongside real disk usage, especially when a host feels slow for no obvious reason.

```bash
free -h                 # RAM and swap, total/used/free, human-readable
swapon --show             # active swap devices/files and how much of each is in use
cat /proc/swaps             # the same information, raw kernel view
```

```bash
vmstat 1 5   # sample every 1s, 5 times - watch the si/so columns (swap in/out per second)
```

A healthy system has `si`/`so` at or near 0 most of the time. Sustained non-zero values mean the kernel is actively paging memory out to disk under pressure right now, not just that swap has been used at some point in the past - `swapon --show`'s "used" figure alone can't tell you that.

### Which processes are using the most swap

```bash
for file in /proc/*/status; do awk '/VmSwap|Name/{printf $2" "}' "$file"; echo; done | sort -k 2 -n -r | head -10
```

This walks every process's `/proc/<pid>/status`, pulls out its name and `VmSwap` value, and sorts the result by swap usage descending - the top lines are the processes actually holding the most swapped-out memory right now.

```bash
sudo smem -s swap -r | head -10   # cleaner equivalent, if smem is installed (apt/dnf install smem)
```

### Controlling swap

```bash
cat /proc/sys/vm/swappiness         # current swappiness (0-100) - how aggressively the kernel swaps
sudo sysctl vm.swappiness=10          # lower it for this boot only - prefer RAM over swap more strongly
```

```bash
# /etc/sysctl.conf or /etc/sysctl.d/99-swappiness.conf, to make it permanent:
vm.swappiness=10
```

```bash
sudo swapoff -a   # disable all swap - forces everything currently swapped back into RAM
sudo swapon -a      # re-enable swap again (reads devices/files listed in /etc/fstab)
```

> `swapoff -a` needs enough free RAM to hold everything that was swapped out, or it will hang or trigger the OOM killer - check `free -h` first on a system under real memory pressure, don't run this blind on a server you don't control.

```bash
sudo fallocate -l 2G /swapfile    # create a 2GB file to use as swap
sudo chmod 600 /swapfile            # restrict access before enabling it - it can contain sensitive memory contents
sudo mkswap /swapfile                 # format it as swap
sudo swapon /swapfile                   # activate it
```

## Useful combinations

```bash
# Biggest directories under /var
du -h --max-depth=1 /var 2>/dev/null | sort -h

# Largest files below the current directory
find . -type f -printf '%s %p\n' 2>/dev/null | sort -rn | head -20

# Match a device to its fstab entry
lsblk -f
grep UUID /etc/fstab

# Check space before and after a cleanup
df -h /var && sudo apt-get clean && df -h /var
```
