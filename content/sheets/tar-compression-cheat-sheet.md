+++
title = "tar & Compression Cheat Sheet"
date = 2026-09-24
description = "Create, extract and inspect tar archives, combine them with gzip/bzip2/xz compression, and work with zip - with the flags that actually matter day to day."
tags = ["linux", "tar", "compression", "backup", "sysadmin"]
+++

`tar` bundles a directory tree into a single archive file. On its own it doesn't compress anything - that's handled by piping through (or asking `tar` to invoke) a separate compressor like `gzip`, `bzip2`, or `xz`.

## Core flags

```bash
tar -c   # create a new archive
tar -x   # extract an existing archive
tar -t   # list the contents of an archive, without extracting
tar -v   # verbose - print each file as it's processed
tar -f   # read from / write to the FILE named next - almost always required
```

`-f` must be immediately followed by the archive filename - it's easy to forget and have `tar` try to read from a tape device (its historical default) instead.

## Creating an archive

```bash
tar -cvf backup.tar /home/user/documents/     # plain archive, no compression
tar -czvf backup.tar.gz /home/user/documents/  # -z: compress with gzip
tar -cjvf backup.tar.bz2 /home/user/documents/ # -j: compress with bzip2 (slower, smaller)
tar -cJvf backup.tar.xz /home/user/documents/  # -J: compress with xz (slowest, smallest)
```

The extension (`.tar.gz`, `.tar.bz2`, `.tar.xz`) is just a convention for humans - `tar` doesn't read it to decide what to do. The compression flag (`-z`/`-j`/`-J`) is what actually matters.

## Extracting an archive

```bash
tar -xvf backup.tar.gz                    # tar auto-detects gzip/bzip2/xz from the file itself
tar -xvf backup.tar.gz -C /tmp/restore/   # -C: extract into a specific directory instead of the current one
```

> Modern `tar` auto-detects the compression format when extracting, so you rarely need `-z`/`-j`/`-J` on extract - only on create. Always extract into an empty or scratch directory first if you're unsure what's inside, rather than the current working directory.

## Listing contents without extracting

```bash
tar -tvf backup.tar.gz                 # full listing with permissions/sizes/dates
tar -tvf backup.tar.gz | grep '\.conf'  # check whether a specific file is in the archive
```

Always worth doing before extracting an archive from an untrusted source, or before overwriting anything.

## Extracting only specific files

```bash
tar -xvf backup.tar.gz etc/nginx/nginx.conf         # pull out just one file (path must match exactly as listed)
tar -xvf backup.tar.gz --wildcards 'etc/nginx/*'    # pull out everything under one directory
```

## Preserving permissions and ownership

```bash
sudo tar -xpvf backup.tar.gz -C /restore/   # -p: preserve original permissions (needs root to restore ownership fully)
```

Without `-p`, extracted files get default permissions based on your current umask, not the archive's original modes - important for system files and backups being restored as root.

## Excluding files when creating an archive

```bash
tar -czvf backup.tar.gz --exclude='*.log' --exclude='node_modules' /home/user/project/
tar -czvf backup.tar.gz -X exclude-list.txt /home/user/project/   # patterns from a file instead
```

```text
# exclude-list.txt - one pattern per line
*.tmp
.cache
node_modules
```

## Checking an archive's compressed size before extracting

```bash
tar -tzvf backup.tar.gz | awk '{sum += $3} END {print sum, "bytes uncompressed"}'   # total uncompressed size
ls -lh backup.tar.gz                                                                # compressed size on disk
```

Useful before extracting a large archive onto a disk with limited free space.

## Compressing a single file (not a directory)

```bash
gzip file.txt        # replaces file.txt with file.txt.gz, removes the original
gzip -k file.txt      # -k: keep the original file too
gunzip file.txt.gz    # decompress, replaces file.txt.gz with file.txt
```

```bash
bzip2 file.txt        # same idea, better ratio, slower - produces file.txt.bz2
xz file.txt           # best ratio, slowest - produces file.txt.xz
```

`gzip`/`bzip2`/`xz` compress a single file in place; they don't bundle multiple files or directories the way `tar` does. That's exactly why `tar` and a compressor are normally paired together.

## Checking compression ratio

```bash
gzip -l file.txt.gz   # shows compressed size, uncompressed size, and ratio
```

## Working with .zip archives

```bash
zip -r archive.zip /home/user/documents/    # -r: recurse into directories
unzip archive.zip                            # extract into the current directory
unzip -l archive.zip                         # list contents without extracting
unzip archive.zip -d /tmp/restore/           # extract into a specific directory
```

`.zip` is the format to reach for when the archive needs to be opened on Windows or macOS without any extra tooling - `tar.gz` is the more common default on Linux-to-Linux transfers.

## Splitting a large archive into parts

```bash
tar -czvf - /home/user/large-project/ | split -b 500M - backup.tar.gz.part-   # split into 500MB chunks while creating
cat backup.tar.gz.part-* > backup.tar.gz                                      # reassemble before extracting
```

Useful for archives too large for a single USB drive, email attachment, or upload limit.

## Common recipes

```bash
# Full backup of a directory, timestamped, compressed
tar -czvf "backup-$(date +%F).tar.gz" /home/user/documents/

# Back up a remote server's directory straight to a local compressed archive over SSH
ssh user@remote-host "tar -czf - /var/www/example.com" > example-com-backup.tar.gz

# Restore that backup on a different machine
tar -xzvf example-com-backup.tar.gz -C /var/www/example.com/

# Archive everything except version control and dependencies before a deploy
tar -czvf release.tar.gz --exclude='.git' --exclude='node_modules' .
```

## Safety notes

- Always `tar -tvf` an unfamiliar archive before extracting it - a malicious or malformed archive can contain absolute paths (`/etc/passwd`) or `../` sequences aimed at writing outside the target directory. Modern `tar` strips leading `/` and warns about `../` by default, but verifying contents first is still good practice.
- Extract into a dedicated, empty directory when restoring anything important, rather than directly into a live directory - it's much easier to compare and merge afterward than to undo an overwrite.
- `xz` gives the smallest files but is the slowest to create and extract - fine for a one-time archive you'll rarely touch again, a poor choice for backups you need to restore quickly under pressure.
- Test a backup by actually extracting it (or at least listing it with `-tvf`) periodically - an archive nobody has successfully restored from is not a verified backup.
