+++
title = "rsync Cheat Sheet"
date = 2026-09-23
description = "Sync files and directories locally or over SSH with rsync: core flags, excludes, dry runs, deletion safety, bandwidth limits and backup recipes."
tags = ["linux", "rsync", "backup", "sysadmin"]
+++

`rsync` copies files and directories, locally or over the network, transferring only the parts of a file that changed instead of the whole thing. It's the standard tool for backups, mirroring, and deployments on Linux.

## Basic syntax

```bash
rsync [options] source destination   # general form
```

Source and destination can each be a local path or a remote one (`user@host:/path`). A trailing slash on the **source** directory matters a lot - see below.

## The trailing slash gotcha

```bash
rsync -av source/ destination/    # copies the CONTENTS of source/ into destination/
rsync -av source destination/     # copies source/ ITSELF (as a subfolder) into destination/
```

> This is the single most common `rsync` mistake. `source/` (trailing slash) means "everything inside this directory"; `source` (no slash) means "this directory as a whole". Always double-check which one you meant before running a real sync.

## Core flags (the ones you'll always use)

```bash
rsync -a source/ destination/    # -a = archive: recursive, preserves permissions, timestamps, symlinks, ownership
rsync -av source/ destination/   # -v = verbose, lists every file transferred
rsync -avz source/ destination/  # -z = compress data during transfer (helps over slow links, not local disks)
rsync -avh source/ destination/  # -h = human-readable sizes (KB/MB/GB instead of raw bytes)
```

`-a` is short for `-rlptgoD` (recursive, links, permissions, times, group, owner, devices) - reach for `-a` by default rather than remembering that list.

## Always dry-run first

```bash
rsync -avn source/ destination/   # -n = dry run, shows what WOULD happen without touching anything
```

> Run every new or risky `rsync` command with `-n` first, especially anything involving `--delete`. It costs nothing and shows you the exact file list before real data moves.

## Progress and resuming

```bash
rsync -avP source/ destination/   # -P = --progress + --partial combined
```

`--progress` shows a live per-file transfer bar; `--partial` keeps partially-transferred files instead of deleting them on interruption, so a repeated `rsync` can resume instead of starting that file over.

## Syncing over SSH

```bash
rsync -avz -e ssh source/ user@remote-host:/path/to/destination/   # push local files to a remote server
rsync -avz -e ssh user@remote-host:/path/to/source/ destination/   # pull remote files down to local
```

```bash
rsync -avz -e "ssh -p 2222" source/ user@remote-host:/path/   # non-default SSH port
```

`-e ssh` tells rsync to tunnel the transfer through SSH - this is the normal way to sync with a remote machine, and it reuses your existing SSH key setup (see the [SSH Cheat Sheet](/sheets/ssh-cheat-sheet/)).

## Deleting files that no longer exist in the source

```bash
rsync -avn --delete source/ destination/   # dry run first - see exactly what would be REMOVED
rsync -av --delete source/ destination/    # then actually mirror, deleting extras in destination
```

> Without `--delete`, rsync only ever adds/updates files - it never removes anything from the destination, even if you deleted it from the source. With `--delete`, a mistaken source path can wipe out real data in the destination. Never run `--delete` without a dry run first.

## Excluding files and directories

```bash
rsync -av --exclude '*.log' source/ destination/            # skip a pattern
rsync -av --exclude 'node_modules/' --exclude '.git/' source/ destination/   # multiple excludes
rsync -av --exclude-from='exclude-list.txt' source/ destination/            # patterns from a file
```

```text
# exclude-list.txt - one pattern per line
*.tmp
.cache/
node_modules/
```

## Including only specific files

```bash
rsync -av --include '*.jpg' --include '*/' --exclude '*' source/ destination/   # only copy .jpg files, recursing into every directory
```

`--include '*/'` is required before the catch-all `--exclude '*'`, or rsync would exclude the directories themselves before it gets a chance to look inside them.

## Checking what changed without copying

```bash
rsync -avc --dry-run source/ destination/   # -c compares file CONTENTS (checksum), not just size/timestamp
```

By default rsync decides a file is "unchanged" using size + modification time, which is fast but can miss changes with an untouched timestamp. `-c` is slower (reads every file) but catches those cases.

## Limiting bandwidth

```bash
rsync -avz --bwlimit=2000 source/ user@remote-host:/path/   # cap transfer at ~2000 KB/s
```

Useful on a shared connection or a metered link, so a large sync doesn't saturate everything else.

## Preserving hard links

```bash
rsync -aH source/ destination/   # -H preserves hard links between files in the source
```

Without `-H`, rsync treats hard-linked files as independent copies at the destination, breaking the link relationship.

## Incremental backups with --link-dest

```bash
rsync -av --link-dest=/backups/2026-09-22 /data/ /backups/2026-09-23/   # hard-link unchanged files from yesterday's backup
```

Files unchanged since the previous backup are hard-linked (near-zero extra disk space) instead of copied again; only actually-changed files consume new space. Each dated folder still looks like a complete, independent backup when browsed.

## Common recipes

```bash
# Mirror a local directory to an external drive, deleting extras, dry-run first
rsync -avn --delete /home/user/documents/ /media/backup/documents/
rsync -av  --delete /home/user/documents/ /media/backup/documents/

# Back up a remote server's web root to a local machine
rsync -avz -e ssh user@server:/var/www/example.com/ ./local-backup/

# Deploy a built site to a server, excluding version control
rsync -avz --delete --exclude '.git/' ./public/ user@server:/var/www/example.com/

# Copy just the changed config files, listing what happened
rsync -avi /etc/nginx/ backup-host:/etc/nginx-backup/
```

`-i` (`--itemize-changes`) prints a short code per file (e.g. `>f.st.....` for "file, size and time changed") so you can see exactly what kind of change triggered each transfer.

## Checking rsync's exit status

```bash
rsync -av source/ destination/; echo "exit code: $?"   # 0 = success, non-zero = something failed
```

A non-zero exit code (commonly `23` - partial transfer due to errors, or `24` - some files vanished mid-transfer) is worth checking in scripts and cron jobs rather than assuming the sync fully succeeded.

## Safety notes

- Always run a risky command (anything with `--delete`, or a new source/destination pair) with `-n`/`--dry-run` first.
- Watch the trailing slash on the **source** path - it changes whether the directory itself or just its contents get copied.
- `--delete` makes the destination match the source exactly, including removals - never point it at a destination with data you can't afford to lose without verifying the dry run.
- Prefer `-a` over remembering individual preserve-flags; add `-H` explicitly if hard links matter for your data.
