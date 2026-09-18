+++
title = "Linux File System Hierarchy"
date = 2026-09-04
description = "A practical reference to the Linux filesystem hierarchy: what each top-level directory is for, virtual filesystems, usr-merge, and troubleshooting full disks."
tags = ["linux", "filesystem", "sysadmin"]
+++

A practical reference to the Linux filesystem hierarchy: what lives where, why, and what to watch out for as an administrator.

## The root of everything: /

Every file, directory, and mounted device on a Linux system hangs off a single root directory, written `/`. There is no "C:\" or separate drive letters — external disks, network shares and removable media are all *mounted* onto a directory somewhere under `/`, becoming part of the same tree. This layout is standardized (loosely) by the Filesystem Hierarchy Standard (FHS), though distributions vary in the details.

## Tree overview

```text
/
├── bin        -> /usr/bin   (often a symlink on modern systems)
├── boot
├── dev
├── etc
├── home
│   └── alice
├── lib        -> /usr/lib   (often a symlink on modern systems)
├── lost+found
├── media
├── mnt
├── opt
├── proc
├── root
├── run
├── sbin       -> /usr/sbin  (often a symlink on modern systems)
├── srv
├── sys
├── tmp
├── usr
│   ├── bin
│   ├── lib
│   └── sbin
└── var
    ├── log
    └── tmp
```

## Main directories

### /boot

**Purpose:** Files needed to boot the system, before the kernel has mounted anything else.

**Common contents:** the Linux kernel (`vmlinuz-*`), the initial RAM disk (`initrd.img-*` / `initramfs-*`), and bootloader files and configuration (`grub/`).

**Admin notes:** Usually a small, separate partition. Kept files accumulate across kernel upgrades; check free space here (`df -h /boot`) before an OS or kernel update, since a full `/boot` can abort the upgrade.

> Never delete kernel files here unless you are certain they belong to a kernel version you no longer boot from — removing the currently running kernel's files can leave the system unbootable.

### /etc

**Purpose:** System-wide configuration files. The name is a historical joke ("et cetera") but in practice it means "static configuration".

**Common contents:** `/etc/passwd`, `/etc/fstab`, `/etc/hosts`, `/etc/ssh/sshd_config`, `/etc/nginx/`, `/etc/systemd/`, `/etc/cron.d/`.

**Admin notes:** Almost every service's configuration lives under here. Back up `/etc` before major changes (`sudo tar czf etc-backup.tar.gz /etc`), and prefer version control (`etckeeper`, or a plain git repo) on servers you manage long-term.

### /home

**Purpose:** Personal directories for regular (non-root) users.

**Common contents:** `/home/alice`, `/home/bob`, each holding that user's own files, dotfiles (`.bashrc`, `.ssh/`), and application data.

**Admin notes:** Often its own partition so a full disk in one user's files doesn't take down the root filesystem. Ownership and permissions here matter — a user's home directory is normally `700` or `750`, owned by that user.

### /root

**Purpose:** The home directory of the `root` (superuser) account. Not to be confused with `/`, the filesystem root.

**Common contents:** root's own shell configuration and any files root has created directly.

**Admin notes:** Only accessible to root by default (`700`). Avoid doing everyday work as root or storing project files here; use `sudo` from a normal account instead.

### /opt

**Purpose:** "Optional" third-party or self-contained application software that doesn't follow the standard `/usr` layout.

**Common contents:** vendor-supplied software such as `/opt/google/chrome/`, `/opt/myapp/`, often bundling its own libraries.

**Admin notes:** Useful when installing packages outside your distribution's package manager. Each application typically gets its own subdirectory (`/opt/<vendor>/<app>`) to avoid clashing with others.

### /dev

**Purpose:** Device files — the kernel's interface to hardware and pseudo-devices, presented as files.

**Common contents:** `/dev/sda` (a disk), `/dev/null`, `/dev/zero`, `/dev/tty1`, `/dev/random`.

**Admin notes:** Managed automatically by `udev`/the kernel; it is a virtual filesystem (`devtmpfs`), rebuilt on every boot.

> Do not manually create, delete, or edit files in `/dev` unless you know exactly what you are doing — these are live interfaces to hardware, not ordinary files.

### /var

**Purpose:** "Variable" data — files whose content is expected to grow or change while the system runs.

**Common contents:** `/var/log/` (system and application logs), `/var/lib/` (application state, e.g. package manager and database data), `/var/spool/` (mail and print queues), `/var/cache/`, `/var/tmp/`.

**Admin notes:** The single most common cause of a Linux server filling its disk. Monitor it routinely:

```bash
du -sh /var/* 2>/dev/null | sort -h
du -sh /var/log/* 2>/dev/null | sort -h
```

### /bin

**Purpose (traditionally):** Essential command binaries needed by all users, including in single-user/recovery mode (`ls`, `cp`, `bash`, `cat`).

**Modern behavior:** On many current distributions (e.g. recent Fedora, Debian, Ubuntu, Arch) `/bin` is a symbolic link to `/usr/bin` as part of the "usr-merge". See [Modern distributions and usr-merge](#modern-distributions-and-usr-merge) below — do not assume this split still holds everywhere.

### /sbin

**Purpose (traditionally):** Essential system administration binaries, mainly for root (`fsck`, `reboot`, `ip`, `iptables`).

**Modern behavior:** Like `/bin`, often a symlink to `/usr/sbin` on current systems.

### /usr

**Purpose:** The bulk of installed user-space programs, libraries, and documentation — historically "Unix System Resources," not "user".

**Common contents:** `/usr/bin/`, `/usr/sbin/`, `/usr/lib/`, `/usr/share/` (documentation, icons, man pages), `/usr/local/` (software installed manually/outside the package manager).

**Admin notes:** On a usr-merged system, `/usr` effectively holds nearly all system binaries, with `/bin`, `/sbin`, `/lib` kept only as compatibility symlinks. `/usr/local` is the conventional place for software you compile or install yourself, separate from distro-managed packages.

### /proc

**Purpose:** A virtual filesystem exposing kernel and process information as files. Nothing here is stored on disk.

**Common contents:** `/proc/cpuinfo`, `/proc/meminfo`, `/proc/<pid>/` (per-process info), `/proc/uptime`.

**Admin notes:** Extremely useful for inspecting system and process state without extra tools:

```bash
cat /proc/cpuinfo
cat /proc/meminfo
ls /proc/1234/fd   # open file descriptors of process 1234
```

> Do not delete or manually edit files under `/proc`. It has no real content on disk to lose, but writing to the wrong file can change live kernel behavior immediately.

### /mnt

**Purpose:** A conventional, generic mount point for filesystems mounted *manually* and temporarily by an administrator.

**Admin notes:** Empty by default; you create subdirectories as needed, e.g. `/mnt/backup`, `/mnt/data`.

### /sys

**Purpose:** A virtual filesystem (`sysfs`) exposing kernel, device, and driver information in a structured way, complementary to `/proc`.

**Common contents:** `/sys/class/net/`, `/sys/block/`, `/sys/devices/`.

**Admin notes:** Some hardware and power-management tuning is done by writing to files here (e.g. CPU governors), but this should be done deliberately and with distro-appropriate tools where available, not by guessing.

> As with `/proc`, avoid poking at `/sys` unless you understand the specific file — it can directly change hardware/driver behavior.

### /media

**Purpose:** A conventional mount point for *removable* media, typically auto-mounted by the desktop environment or `udisks`.

**Common contents:** `/media/<user>/<label>` for a plugged-in USB drive or inserted disc.

**Admin notes:** On headless servers this is rarely used since there's no desktop auto-mount daemon; `/mnt` is the more common manual choice there.

### /run

**Purpose:** A `tmpfs` (RAM-backed) virtual filesystem for runtime data needed since the last boot: PID files, sockets, and other transient state used by running services.

**Common contents:** `/run/systemd/`, `/run/lock/`, PID files such as `/run/nginx.pid`.

**Admin notes:** Cleared automatically on every reboot. Replaced older, disk-based `/var/run` and `/var/lock`, which are now typically symlinks to `/run` and `/run/lock`.

### /tmp

**Purpose:** Temporary files for any user or application, expected to be short-lived.

**Common contents:** application scratch files, temporary downloads, session data.

**Admin notes:** On many systems `/tmp` is also `tmpfs` (RAM-backed) and is cleared on reboot, though this depends on the distribution's configuration (`/etc/fstab`, `systemd-tmpfiles`). World-writable with the sticky bit set (`drwxrwxrwt`), so users cannot delete each other's files.

### /lost+found

**Purpose:** Where `fsck` (filesystem check/repair) places recovered file fragments it cannot otherwise reconnect to the directory tree, on `ext`-family filesystems.

**Admin notes:** Present at the root of each `ext2/3/4` filesystem (so you may see one per mounted partition, e.g. `/lost+found` and `/home/lost+found`). Normally empty; contents appearing here usually indicate a filesystem was checked after an unclean shutdown.

> Files recovered into `lost+found` have lost their original names; inspect them with `file` before deciding whether to keep or discard them.

### /lib

**Purpose (traditionally):** Essential shared libraries needed by binaries in `/bin` and `/sbin`, plus kernel modules under `/lib/modules/`.

**Modern behavior:** Frequently a symlink to `/usr/lib` on usr-merged systems (see below); kernel modules generally remain at `/lib/modules/<kernel-version>/` (or `/usr/lib/modules/` depending on the distribution).

### /srv

**Purpose:** Data served by this system to others, e.g. content for a web or FTP server.

**Common contents:** `/srv/www/`, `/srv/ftp/`, `/srv/git/`.

**Admin notes:** Optional in practice — many web servers are configured instead to serve from `/var/www` by distro convention. Both are valid; use whichever your distribution or team standardizes on.

## / vs /root

- **`/`** is the *filesystem root* — the top of the entire directory tree, containing every other directory.
- **`/root`** is just the *root user's home directory*, one directory among many, analogous to `/home/alice` but for the superuser.

## /home vs /root

- **`/home/<user>`** holds files for ordinary, non-privileged user accounts.
- **`/root`** holds files only for the `root` superuser account, and is not under `/home`.

## /mnt vs /media

- **`/mnt`** is for filesystems an administrator mounts *manually*, usually temporarily, using `mount` or an `/etc/fstab` entry.
- **`/media`** is for *removable* media (USB sticks, CDs/DVDs), conventionally auto-mounted by the desktop environment, one subdirectory per device.

## /tmp vs /var/tmp vs /run

| Directory | Backing | Survives reboot? | Typical use |
|---|---|---|---|
| `/tmp` | Often `tmpfs` (RAM) | Usually no | Short-lived scratch files for any process |
| `/var/tmp` | Disk | Yes | Temporary files that should survive a reboot (e.g. an in-progress package upgrade) |
| `/run` | `tmpfs` (RAM) | No | Runtime state for the current boot only: PID files, sockets |

## Virtual and runtime filesystems: /proc, /sys, /dev, /run

Four of the directories above don't hold real files on disk at all — they are generated by the kernel in memory:

- **`/proc`** — process and kernel state, one virtual file per piece of information.
- **`/sys`** — kernel/device/driver structure, organized by subsystem.
- **`/dev`** — device nodes, the kernel's file-based interface to hardware.
- **`/run`** — early-boot and service runtime state (PID files, sockets), `tmpfs`-backed.

They are recreated fresh on every boot, so their size never shows up as real disk usage, and nothing meaningful is lost by rebooting. Treat them as read-only unless you specifically know you need to write to a given file.

## Modern distributions and usr-merge

Historically, `/bin`, `/sbin`, and `/lib` held the minimal set of binaries/libraries needed before `/usr` (potentially a separate partition) was mounted. Many current distributions (including recent Debian, Ubuntu, Fedora, and Arch releases) have adopted the **"usr-merge"**, where `/bin`, `/sbin`, and `/lib` (and `/lib64` where present) are symbolic links into the corresponding directories under `/usr`:

```bash
ls -ld /bin /sbin /lib
# lrwxrwxrwx ... /bin -> usr/bin
# lrwxrwxrwx ... /sbin -> usr/sbin
# lrwxrwxrwx ... /lib -> usr/lib
```

This is **not universal** — some distributions and embedded systems still keep the classic split with `/usr` as an optionally separate partition. Check with `ls -ld /bin` on the system you're actually working on rather than assuming either layout.

## Useful commands for exploring the hierarchy

```bash
pwd                 # print the current working directory
ls /                # list top-level directories
ls -la /etc         # long listing, including hidden dotfiles
tree -L 2 /var      # visual tree, 2 levels deep (needs the `tree` package)
findmnt             # show the current mount tree
df -h               # disk space per mounted filesystem, human-readable
du -sh /var/log     # total size of a directory
stat /etc/passwd    # detailed metadata: size, permissions, timestamps
```

## Checking disk usage safely

```bash
# Overall picture first
df -h

# Biggest consumers under /var
du -sh /var/* 2>/dev/null | sort -h

# Biggest logs
du -sh /var/log/* 2>/dev/null | sort -h

# Per-user home directory sizes (run as root to see every user)
sudo du -sh /home/* 2>/dev/null | sort -h

# What's filling /tmp right now
du -sh /tmp/* 2>/dev/null | sort -h
```

`2>/dev/null` hides "permission denied" noise from directories you can't read; run with `sudo` if you need the real totals.

## Troubleshooting common situations

**`/var` is full:**

```bash
df -h /var
du -sh /var/* 2>/dev/null | sort -h
```
Usually `/var/log` or `/var/lib/docker` (container images/volumes) is the culprit. Rotate or compress old logs rather than deleting active ones blindly.

**A log file has grown huge:**

```bash
sudo du -sh /var/log/*.log
sudo truncate -s 0 /var/log/big-app.log   # empty it without deleting the file the process still has open
```
Deleting a log file a running process still has open frees no space until that process is restarted (the disk blocks stay allocated to the now-unlinked inode). Truncating in place, or a proper `logrotate` setup, avoids that.

**`/tmp` is full:**

```bash
df -h /tmp
du -sh /tmp/* 2>/dev/null | sort -h
```
Safe to clear entries that are clearly stale and not owned by a running process; on a `tmpfs` `/tmp`, a reboot also clears it.

**A user's `/home` is full:**

```bash
sudo du -sh /home/<user>/* 2>/dev/null | sort -h
```
Talk to the user before deleting anything under their home directory — it's their data, not shared system state.

## Safety notes

- Do not manually delete or create files in `/proc`, `/sys`, `/dev`, or `/run` unless you know precisely what that specific file does — they represent live kernel/hardware/process state, not ordinary storage.
- Be careful with `sudo rm`, especially `rm -rf`: there is no undo, wildcards expand before `rm` sees them, and a stray space (`rm -rf / /home` versus `rm -rf / /home`) can be catastrophic. Prefer `rm -i` for anything destructive, and double-check the path with `pwd`/`ls` first.
- Inspect a path before deleting: `ls -la <path>` and `stat <path>` cost nothing and confirm you are looking at what you think you are.
- When in doubt about whether a directory is safe to clear, check whether a process still has it open (`lsof +D /path`) before removing its contents.
