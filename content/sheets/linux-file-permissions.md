+++
title = "Linux User and File Permissions Cheat Sheet"
date = 2026-08-26
description = "Read ls -l output, understand permission classes and octal modes, use chmod and chown safely, and work with SUID, SGID, sticky bit, umask and ACLs."
tags = ["linux", "security", "filesystem", "sysadmin"]
+++

A practical reference for Linux users, groups, and file permissions: reading `ls -l`, changing modes with `chmod`, ownership with `chown`/`chgrp`, special permissions, `umask`, and troubleshooting access problems.

## 1. Reading `ls -l` output

```bash
ls -l deploy.sh
```

```text
-rwxr-xr-- 1 alex developers 4096 Sep 12 10:30 deploy.sh
```

| Field | Value | Meaning |
|---|---|---|
| `-` | file type | regular file (see the type table below) |
| `rwx` | owner permissions | `alex` can read, write, execute |
| `r-x` | group permissions | `developers` can read, execute, not write |
| `r--` | other permissions | everyone else can only read |
| `1` | hard-link count | number of hard links pointing to this file |
| `alex` | owner | the user who owns the file |
| `developers` | group | the group that owns the file |
| `4096` | size | file size in bytes |
| `Sep 12 10:30` | modification time | when the content was last changed |
| `deploy.sh` | name | the file or directory name |

### File type characters

The first character of the ten-character permission string identifies the type:

| Character | Type |
|---|---|
| `-` | Regular file |
| `d` | Directory |
| `l` | Symbolic link |
| `c` | Character device (e.g. `/dev/tty`) |
| `b` | Block device (e.g. `/dev/sda`) |
| `s` | Socket |
| `p` | Named pipe (FIFO) |

## 2. Permission classes and basic permission bits

Three classes, each with three possible bits:

- **`u`** — user/owner
- **`g`** — group
- **`o`** — others
- **`a`** — all three classes at once (used with `chmod`, not shown by `ls -l`)

Each class has:

- **`r`** — read
- **`w`** — write
- **`x`** — execute
- **`-`** — that permission is denied

```text
-rwxr-xr--
 ^^^ ^^^ ^^^
 user group other
```

### Files vs. directories: the same letters mean different things

| Bit | On a file | On a directory |
|---|---|---|
| `r` | Read the file's contents | List the names of entries in the directory (`ls`) |
| `w` | Modify the file's contents | Create, delete, or rename entries **inside** the directory |
| `x` | Execute the file (script/binary) | "Search"/traverse the directory — required to `cd` into it or access anything inside by path, even if you know the exact name |

Two important nuances:

- **Write on a directory controls the directory's contents, not the files themselves.** A user with write access to a directory can delete or rename a file inside it even if they don't own that file and can't write to it directly — permissions on the file don't protect it from this.
- **A directory needs `x` at every level of the path to reach anything inside it.** If any parent directory in the path is missing `x` for you, you cannot access the file underneath, regardless of that file's own permissions or even a generous ACL on it.

## 3. Octal permissions

Each permission bit has a numeric value:

```text
r = 4
w = 2
x = 1
```

Add the values for each class to get one digit; three digits cover user, group, other.

| Mode | Symbolic | Typical use |
|---|---|---|
| `777` | `rwxrwxrwx` | Everyone can read, write, execute — almost never appropriate |
| `755` | `rwxr-xr-x` | Executables and directories others should be able to use but not modify |
| `750` | `rwxr-x---` | Executable/directory usable by the owner and group only |
| `700` | `rwx------` | Private executable/directory, owner only |
| `666` | `rw-rw-rw-` | Readable/writable by everyone — rarely correct for a file |
| `664` | `rw-rw-r--` | Group-shared file, others can read |
| `660` | `rw-rw----` | Group-shared file, no access for others |
| `644` | `rw-r--r--` | Common default for regular files (owner edits, everyone reads) |
| `640` | `rw-r-----` | Readable by owner and group only, e.g. a config file with secrets |
| `600` | `rw-------` | Private file, owner only — SSH keys, credentials |
| `400` | `r--------` | Read-only, owner only — an extra safeguard against accidental edits |

> `777` means anyone on the system can read, overwrite, or (if it's a script/binary) execute the file. It is almost never the right fix. If something "isn't working" because of a permission error, find out what access is actually missing instead of opening everything up.

## 4. `chmod`

### Symbolic syntax

```bash
chmod u+x script.sh              # add execute for the owner
chmod g-w file.txt                # remove write for the group
chmod o-r file.txt                # remove read for others
chmod u=rw,g=r,o= file.txt         # set owner rw, group read-only, others nothing
```

### Numeric syntax

```bash
chmod 644 file.txt                # rw-r--r--
chmod 755 script.sh                # rwxr-xr-x
chmod 700 private-key.pem          # rwx------
```

### Recursive changes — and their risk

```bash
chmod -R 750 shared-directory/
```

`-R` applies the same mode to every file and subdirectory underneath. That's the problem: **directories and files usually need different permissions.** A directory typically needs `x` to be traversable; most regular files should not be executable. Running a single recursive `chmod` mode over a mixed tree either:

- makes ordinary files executable when they shouldn't be (using a directory-appropriate mode like `750` on everything), or
- strips the `x` a directory needs to be entered (using a file-appropriate mode like `640` on everything).

**Safer approach — set directories and files separately:**

```bash
find shared-directory/ -type d -exec chmod 750 {} +
find shared-directory/ -type f -exec chmod 640 {} +
```

This gives directories the traversal bit they need while keeping regular files non-executable.

## 5. Ownership and groups

### Inspecting identity and ownership

```bash
whoami                 # the current user
id                      # current user, uid, group, gid, and all group memberships
groups                  # groups the current user belongs to
ls -l file.txt           # owner and group of a file
stat file.txt            # detailed metadata: owner, group, permissions, timestamps, inode
```

### Changing ownership

```bash
chown alex file.txt                  # change the owner only
chown alex:developers file.txt        # change owner and group together
chgrp developers file.txt             # change the group only
sudo chown -R alex:developers project/  # recursively re-own a project directory
```

> Be careful with recursive ownership changes in system locations such as `/`, `/etc`, `/usr`, `/var`, or an application's installation directory. Re-owning files a service or package manager expects to be owned by `root` (or another system account) can break that service, break future package upgrades, or open a security hole. Scope `chown -R` narrowly — to a specific project or data directory you manage — and double-check the path before running it.

## 6. Special permissions

Beyond the standard `rwx` bits, three special permissions change behavior:

- **SUID (Set User ID)** — on an executable, the program runs with the privileges of the file's **owner**, not the user who launched it. Classic example: `/usr/bin/passwd` runs as root so an ordinary user can update `/etc/shadow`.
- **SGID (Set Group ID)** — on an executable, it runs with the file's **group** privileges. On a **directory**, new files and subdirectories created inside automatically inherit that directory's group, instead of the creating user's primary group — the standard way to make a shared team directory actually stay shared.
- **Sticky bit** — on a directory, only the file's **owner** (or root) can delete or rename it, even if others have write access to the directory. Used on world-writable shared directories like `/tmp` so users can't delete each other's files.

```bash
chmod 4755 program                     # SUID + rwxr-xr-x
chmod 2775 shared-directory            # SGID + rwxrwsr-x
chmod 1777 shared-temporary-directory  # sticky + rwxrwxrwt
```

The leading digit is the special-bit sum: SUID = `4`, SGID = `2`, sticky = `1` (combine as needed, e.g. `6` for SUID+SGID).

> **SUID needs special care.** A SUID binary — especially one owned by `root` — runs with elevated privileges regardless of who invokes it, so a bug or a misconfigured SUID program is a direct path to privilege escalation. Only set SUID on binaries that specifically require it, never as a shortcut to work around a permissions error, and periodically audit for unexpected SUID files: `find / -perm -4000 -type f 2>/dev/null`.
>
> **The sticky bit is why `/tmp` works as a shared directory.** Without it, anyone with write access to `/tmp` (i.e. everyone) could delete or rename any other user's temporary files.

## 7. `umask`

`umask` sets the permission bits that are **removed** from the default when a new file or directory is created — it doesn't grant permissions, it subtracts them.

```bash
umask        # show the current umask
umask 022    # set it for the current shell session
umask 027    # a stricter umask
```

New files start from a base of `666` (`rw-rw-rw-`, never executable by default, regardless of umask) and new directories from `777` (`rwxrwxrwx`). The umask is subtracted from that base:

| umask | New file mode | New directory mode |
|---|---|---|
| `022` | `644` (`rw-r--r--`) | `755` (`rwxr-xr-x`) |
| `027` | `640` (`rw-r-----`) | `750` (`rwxr-x---`) |
| `077` | `600` (`rw-------`) | `700` (`rwx------`) |

`022` is a common default (owner can edit, everyone can read). `027`/`077` are stricter choices for shared or sensitive systems where group or other access shouldn't be granted automatically.

## 8. Practical scenarios and troubleshooting

**Make a shell script executable:**

```bash
chmod +x deploy.sh
./deploy.sh
```

**Secure a private SSH key:**

```bash
chmod 600 ~/.ssh/id_ed25519
```
SSH clients refuse to use a private key that's readable by group or others — this is required, not just good practice.

**Create a group-shared directory with SGID, so it stays shared:**

```bash
sudo mkdir /srv/team-share
sudo chgrp developers /srv/team-share
sudo chmod 2775 /srv/team-share
```

**Find files owned by a specific user:**

```bash
find /home -user alex -type f 2>/dev/null
```

**Check why a user can't access a file:**

```bash
id                       # confirm the user's uid/gid and group memberships
ls -l /path/to/file        # owner, group, and mode of the file itself
groups alex                # is alex actually in the group that owns the file?
```

**Check parent-directory permissions** — remember every directory in the path needs `x` for you:

```bash
ls -ld / /home /home/alex /home/alex/project
```

**Walk the whole path at once with `namei -l`, where available:**

```bash
namei -l /home/alex/project/deploy.sh
```
This prints the permissions of every component of the path in one pass, making a missing `x` on a parent directory immediately obvious.

**Check ACLs if owner/group/other permissions don't explain the access you're seeing:**

```bash
getfacl file.txt
```

> A `+` at the end of the permission string in `ls -l` output (e.g. `rwxr-x---+`) means the file has an ACL granting additional per-user or per-group permissions beyond the standard three classes. ACLs are an advanced topic beyond this sheet's scope — `getfacl`/`setfacl` are the tools to reach for when standard permissions genuinely aren't enough (e.g. one extra user needs access without changing the file's group).

## 9. Security best practices

- **Use least privilege.** Grant only the access actually needed — start narrow and add permissions when a real need appears, rather than starting broad and hoping nothing goes wrong.
- **Avoid `chmod 777`.** It is almost never the correct fix; if a permission error shows up, find the specific missing bit instead.
- **Prefer group-based sharing over world-writable files.** Add the right users to a group and use `770`/`2775`-style modes instead of making something writable by everyone.
- **Protect SSH keys and sensitive configuration.** Private keys and files containing credentials should be `600` (or `400`), owned by the account that actually needs them.
- **Check ownership and parent-directory permissions before changing modes.** A permission problem is often actually an ownership problem, or a missing `x` several directories up — confirm the real cause before reaching for `chmod`.
- **Test permission changes as a non-privileged user when possible.** Verifying access as the actual account that needs it (or with `sudo -u`) catches mistakes that testing as root would silently hide.
