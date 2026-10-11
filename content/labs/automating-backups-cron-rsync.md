+++
title = "Automating Backups with cron and rsync"
date = 2026-10-11
description = "A practical end-to-end backup pipeline for a WordPress site: mysqldump plus rsync's --link-dest incremental snapshots, scheduled safely with cron and flock, pruned automatically, and actually verified with a real restore - including a --link-dest gotcha that silently breaks deduplication if missed."
tags = ["linux", "backup", "rsync", "cron", "sysadmin"]
+++

**Goal:** turn "I have a backup script" into an actual automated pipeline - database dump plus files, run nightly without anyone remembering to kick it off, old copies pruned automatically, and a real restore tested at the end so "it's backed up" is a verified fact instead of an assumption.

**Why this is worth doing properly, not just `cp -r`-ing things on a schedule:** a backup nobody has ever restored from isn't a backup, it's a hope. This walks through the same mistake it's easy to make - a `--link-dest` incremental setup that *looked* like it was deduplicating correctly for weeks, silently wasn't, and the proof is in the Verification section below, not just taken on faith.

## 1. What we're backing up, and where

Using the WordPress site from the [Nginx multi-site lab](/labs/nginx-multiple-websites-server/) as the concrete example: the site files at `/var/www/example.com` and its MySQL database, backed up nightly to a dedicated second disk mounted at `/backups`.

```bash
lsblk                                  # confirm the backup disk is attached
sudo mkdir -p /backups
sudo mount /dev/sdb1 /backups            # or an fstab entry, for a permanent mount
```

> A dedicated disk (or at minimum a separate filesystem) matters for the mount-check guard in the next section - if backups just land in a directory on the same root filesystem, there's nothing to check and nothing stops a backup from running against an empty, unmounted path.

## 2. The backup script

```bash
#!/usr/bin/env bash
set -euo pipefail

SRC_FILES="/var/www/example.com"
SRC_DB="example_wp"
BACKUP_ROOT="/backups/example.com"
DATE="$(date +%F)"
DEST="$BACKUP_ROOT/$DATE"
LATEST_LINK="$BACKUP_ROOT/latest"
LOG="/var/log/backup-example.log"

# bail out loudly if the backup disk isn't actually mounted - see section 3
mountpoint -q "$BACKUP_ROOT" || { echo "$(date): $BACKUP_ROOT not mounted, aborting" >> "$LOG"; exit 1; }

mkdir -p "$DEST"

# dump the database first, straight into this run's dated folder
mysqldump --single-transaction "$SRC_DB" | gzip > "$DEST/db.sql.gz"

# resolve "latest" to a real path before using it - see section 4, this is the part that bit us
PREV_REAL="$(readlink -f "$LATEST_LINK" 2>/dev/null || true)"

if [ -n "$PREV_REAL" ] && [ -d "$PREV_REAL/files" ]; then
    rsync -a --delete --link-dest="$PREV_REAL/files" "$SRC_FILES/" "$DEST/files/"
else
    rsync -a "$SRC_FILES/" "$DEST/files/"
fi

# only point "latest" at this run after it succeeded
ln -sfn "$DEST" "$LATEST_LINK"

echo "$(date): backup completed -> $DEST" >> "$LOG"
```

`--single-transaction` lets `mysqldump` take a consistent snapshot of InnoDB tables without locking them for the duration of the dump - the site stays writable while the backup runs. See the [rsync cheat sheet's `--link-dest` section](/sheets/rsync-cheat-sheet/#incremental-backups-with-link-dest) for the mechanics of the hard-link trick itself; this script is what actually wires it into a real pipeline.

## 3. Guard against the silent-wipe disaster: check the mount first

```bash
mountpoint -q "$BACKUP_ROOT" || { echo "$(date): $BACKUP_ROOT not mounted, aborting" >> "$LOG"; exit 1; }
```

If the backup disk ever fails to mount after a reboot, `/backups` still exists as an ordinary empty directory on the root filesystem - and a script with no guard would happily `rsync` straight into it. With `--delete` in the mix, the *next* run after that would then see files "missing" from a healthy-looking destination and delete the corresponding files from every subsequent incremental snapshot too, since each one hard-links forward from the last. One missed mount turns into quietly destroyed backup history. `mountpoint -q` costs one line and catches this before anything else runs.

## 4. The --link-dest gotcha: it does not follow a symlink

The obvious way to track "the most recent backup" is a `latest` symlink, updated after each successful run - so the natural next step looks like:

```bash
rsync -a --delete --link-dest="$LATEST_LINK" "$SRC_FILES/" "$DEST/files/"   # looks reasonable - is not
```

This runs without error, finishes fast, and the resulting snapshot *looks* complete. But check the actual disk usage or compare inode numbers between two consecutive snapshots for a file that didn't change, and every single file was copied fresh - zero deduplication happened, silently. `rsync` does not resolve `--link-dest` through a symlink; it needs the real directory path. The fix is one line, resolving the symlink before it's used:

```bash
PREV_REAL="$(readlink -f "$LATEST_LINK" 2>/dev/null || true)"
# then use --link-dest="$PREV_REAL/files", never --link-dest="$LATEST_LINK" directly
```

> This is the kind of bug that a backup job can run "successfully" with for weeks - no errors, no alerts, correct-looking file counts - while quietly using far more disk than intended and giving no indication anything is wrong, until the disk fills up or someone finally checks whether old snapshots are actually sharing space. Confirm the fix with `ls -i` on the same file across two snapshot folders: matching inode numbers means it's genuinely hard-linked, not just present in both places.

## 5. Pruning old snapshots

Each dated folder is a complete, independent-looking backup (that's the point of `--link-dest`), so cleanup is just removing whole directories once they're old enough:

```bash
find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime +14 -exec rm -rf {} \;   # drop anything older than 14 days
```

`-maxdepth 1 -mindepth 1 -type d` matches only the dated snapshot directories directly inside `$BACKUP_ROOT`, not `latest` (a symlink, not a directory - `-type d` skips it on its own) and not anything nested deeper inside a snapshot.

## 6. Preventing overlapping runs with flock

If a backup ever runs long - a bigger-than-usual dump, a slow disk - and the next scheduled run starts before it finishes, two `rsync` processes writing into the same dated folder at once is how corruption happens. Wrap the cron entry in `flock`, exactly as covered in the [crontab cheat sheet's locking section](/sheets/crontab-cheat-sheet/#redirecting-output-to-a-log-file):

```bash
0 2 * * *  /usr/bin/flock -n /var/lock/backup-example.lock /usr/local/bin/backup-example.sh
```

`-n` makes `flock` exit immediately (skipping that run) instead of queuing up a second copy to start the moment the first one finishes - for a nightly backup, skipping one run and catching up the next night beats two overlapping ones.

## 7. Scheduling and getting notified on failure

```bash
sudo crontab -e
```

```text
MAILTO=alex@example.com
0 2 * * *  /usr/bin/flock -n /var/lock/backup-example.lock /usr/local/bin/backup-example.sh
```

Running this as `sudo crontab -e` (root's crontab, not a regular user's) matters here - a normal user account typically can't read every file under `/var/www` or take a full `mysqldump`, and `MAILTO` only helps if the script actually reaches cron's mail step, which an early permission failure would prevent.

> A cron job that exits non-zero without ever printing anything is easy to miss even with `MAILTO` set, if the mail transport itself isn't configured on the box. A free external health-check ping (e.g. `curl -fsS --retry 3 https://hc-ping.com/your-uuid-here` appended as the script's last line, only reached on success) catches the case `MAILTO` can't: the job not running *at all*, because cron itself is down or the entry got deleted.

## Verification - prove a restore actually works

```bash
ls -i /backups/example.com/2026-09-27/files/style.css /backups/example.com/2026-09-28/files/style.css
# matching inode numbers = genuinely hard-linked, confirming section 4's fix is actually working
```

```bash
# restore a single file from an older snapshot, compare it against the live site
diff /backups/example.com/2026-09-27/files/wp-config.php /var/www/example.com/wp-config.php
```

```bash
# restore the database dump into a scratch database, never straight into production
gunzip -c /backups/example.com/2026-09-27/db.sql.gz | mysql example_wp_restore_test
```

```bash
grep "backup completed" /var/log/backup-example.log | tail -5   # confirms cron is actually firing on schedule, not just that the script works when run by hand
```

Restoring into a **separate test database**, not the live one, is deliberate - this step is about proving the dump file is valid and restorable, not about actually performing a restore.

## Safety notes

- `mountpoint -q` before anything else runs - see section 3. This single check is the difference between "disk didn't mount after a reboot" and "silently destroyed backup history."
- Never pass a symlink directly to `--link-dest` - resolve it with `readlink -f` first, and verify with matching `ls -i` inode numbers rather than trusting that a clean exit code means deduplication actually happened.
- `--delete` makes each snapshot's `files/` match the live source exactly, including removals - correct for a point-in-time snapshot, but confirm the *source* is actually in a sane state before running against it (an accidental `rm -rf` on the live site, backed up five minutes later, "successfully" propagates the deletion into that day's snapshot too - older snapshots are unaffected, which is exactly why retention policy and more than one day of history both matter).
- Database dumps contain real data in plaintext - lock down permissions on the backup destination (`chmod 700` on the backup root, dumps readable only by root) same as the production database itself.
- Test an actual restore on a schedule, not just once while setting this up - a backup pipeline that silently broke (wrong path, expired credentials, a cron entry that got removed) is only caught by periodically proving a restore still works, not by assuming a lack of error emails means everything is fine.
