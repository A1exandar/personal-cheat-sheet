+++
title = "find Cheat Sheet"
date = 2026-09-01
description = "Locate files with find by name, type, size, time, owner and permissions, and combine it with grep to search file content."
tags = ["linux", "cli", "filesystem", "sysadmin"]
+++

A quick reference for `find`, which walks a directory tree and matches filesystem objects by their attributes.

## Search by exact filename

```bash
find /etc -name "hosts"       # find a file named exactly "hosts" under /etc
find /path -name "filename"   # generic template: exact name match anywhere under /path
```

## Search by partial filename

```bash
find /var/log -name "*.log"   # every .log file directly matched under /var/log
find /path -name "*.log"      # generic template: same glob, anywhere under /path
```

The pattern is a shell glob. Quote it so the shell passes it to `find` rather than expanding it first.

## Case-insensitive filename search

```bash
find /etc -iname "*.conf"    # match .conf files under /etc regardless of case
find /path -iname "*.CONF"   # same pattern - still matches lowercase "*.conf" too
```

## Search by file type

```bash
find /path -type f      # regular files
find /path -type d      # directories
find /path -type l      # symbolic links
```

## Search by size

```bash
find /var -type f -size +100M      # larger than 100 MB
find /var -type f -size -1k        # smaller than 1 KB
find /var -type f -size +500M -size -1G
```

`+` means "more than", `-` means "less than", and the suffix is `k`, `M` or `G`.

## Search by modification time

```bash
find /etc -mtime -1        # modified in the last 24 hours
find /var/log -mtime +30   # not modified in over 30 days
find /tmp -mmin -15        # modified in the last 15 minutes
```

`-mtime` counts 24-hour periods; `-mmin` counts minutes. Related: `-atime` (accessed), `-ctime` (metadata changed).

## Search by owner

```bash
find /home -user alexandar          # files owned by user alexandar
find /var/www -not -user www-data   # files NOT owned by www-data
```

## Search by permissions

```bash
find /path -perm 644              # exactly 644
find / -type f -perm -4000        # any file with the setuid bit
find /var/www -type f -perm /022  # group- or world-writable
```

`-perm 644` matches exactly; `-perm -MODE` matches files that have at least those bits; `-perm /MODE` matches files that have any of those bits.

## Running a command on each result: -exec

```bash
find /var/log -name "*.log" -mtime +30 -exec gzip {} \;   # compress logs older than 30 days
find /tmp -type f -mtime +7 -exec rm {} \;                 # delete temp files older than 7 days
find $HOME -type d -exec chmod 755 {} \;                   # reset every directory under $HOME to 755
```

`{}` is replaced with each matched path. `\;` runs the command once per file. Using `+` instead runs the command once with many paths at a time, which is far faster:

```bash
find /var/log -name "*.gz" -mtime +90 -exec rm {} +   # delete compressed logs older than 90 days
```

## -exec vs xargs

```bash
# -exec: find runs the command itself
find /etc -name "*.conf" -exec grep -l "ssl" {} +

# xargs: find prints paths, xargs builds the command
find /etc -name "*.conf" -print0 | xargs -0 grep -l "ssl"
```

`-exec ... +` and `xargs` both batch arguments and perform similarly. Use `-print0` with `xargs -0` so filenames containing spaces or newlines are handled safely. `xargs` adds extra control such as `-P` for parallelism and `-n` to limit arguments per call.

## Searching file content: find + grep

`find` locates files by their attributes; it cannot look inside them. Hand its results to `grep` to search the text:

```bash
# Files under /etc that contain a pattern
find /etc -type f -exec grep -l "PermitRootLogin" {} \;

# Faster, batched form
find /etc -type f -exec grep -l "PermitRootLogin" {} +

# Only .conf files, with line numbers
find /etc -type f -name "*.conf" -exec grep -Hn "ssl_protocols" {} +

# Same idea via xargs, space-safe
find /var/log -type f -name "*.log" -print0 | xargs -0 grep -i "out of memory"
```

## find vs grep

- **`find`** searches *filesystem objects* — it matches on name, type, size, timestamps, owner and permissions.
- **`grep`** searches *text* — it matches patterns inside file contents.

Combine them when the question is "which files, selected by their attributes, also contain this text".
