+++
title = "Users & Groups Management Cheat Sheet"
date = 2026-09-30
description = "Create, modify and delete Linux user accounts and groups: useradd/usermod/userdel, groupadd, password aging with chage, group membership, and the /etc/passwd, /etc/shadow and /etc/group files behind it all."
tags = ["linux", "users", "groups", "sysadmin"]
+++

Managing accounts and group membership - not file permission bits, which the [Linux User and File Permissions Cheat Sheet](/sheets/linux-file-permissions/) already covers. This one is about the accounts themselves: creating, modifying, locking and deleting users and groups, and the files that store all of it.

## Where account info actually lives

```text
/etc/passwd    # one line per user: username, uid, gid, home dir, shell, etc.
/etc/shadow    # password hashes and password-aging data - root-readable only
/etc/group     # one line per group: name, gid, member usernames
/etc/gshadow    # group password hashes (rarely used) and group admins
```

```text
# /etc/passwd format, colon-separated
alex:x:1000:1000:Alex Djordjevic:/home/alex:/bin/bash
 |    |  |    |        |              |        |
 |    |  |    |        |              |        └─ login shell
 |    |  |    |        |              └─ home directory
 |    |  |    |        └─ full name / GECOS field
 |    |  |    └─ primary group ID (GID)
 |    |  └─ user ID (UID)
 |    └─ password placeholder - 'x' means the real hash is in /etc/shadow
 └─ username
```

```text
# /etc/shadow format, colon-separated
alex:$6$abc...xyz:19800:0:90:7:::
 |      |          |    |  | |
 |      |          |    |  | └─ inactivity period after expiry before the account is disabled
 |      |          |    |  └─ warning period before password expiry (days)
 |      |          |    └─ maximum password age (days)
 |      |          └─ minimum password age (days) before it can be changed again
 |      └─ days since 1970-01-01 the password was last changed
 └─ hashed password ($6$ = SHA-512; !, !! or * means the account has no valid password / is locked)
```

## Creating users

```bash
sudo useradd -m -s /bin/bash alex        # -m creates the home directory, -s sets the login shell
sudo useradd -m -G sudo,docker alex        # also add to supplementary groups at creation time
sudo useradd -m -c "Alex Djordjevic" alex    # set the GECOS full-name field
```

```bash
sudo adduser alex      # Debian/Ubuntu's friendlier interactive wrapper around useradd
                          # - prompts for password and full name, creates the home dir automatically
```

`useradd` alone, with no flags, creates the account but **not** a home directory and leaves the password locked - `-m` and setting a password are both easy to forget.

## Setting and changing passwords

```bash
sudo passwd alex           # set/change another user's password (prompts twice)
passwd                       # change your own password
sudo passwd -l alex           # lock the account - prefixes the hash with ! in /etc/shadow
sudo passwd -u alex            # unlock it again
sudo passwd -e alex             # expire it immediately - user must set a new one at next login
sudo passwd -S alex               # show status: L (locked), NP (no password), P (usable password)
```

## Modifying existing users

```bash
sudo usermod -aG docker alex        # ADD to a supplementary group - always use -a with -G
sudo usermod -G docker,sudo alex      # without -a: REPLACES all supplementary groups with this list
sudo usermod -s /usr/bin/zsh alex       # change the login shell
sudo usermod -d /srv/alex -m alex        # change home directory, -m moves the existing contents there
sudo usermod -l newname oldname           # rename the login (doesn't rename the home dir automatically)
sudo usermod -L alex                        # lock the account (same effect as passwd -l)
sudo usermod -U alex                         # unlock it
```

## Deleting users

```bash
sudo userdel alex             # remove the account, leave the home directory and mail spool in place
sudo userdel -r alex            # also remove the home directory and mail spool
sudo userdel -f alex             # force removal even if the user is currently logged in - use with care
```

## Creating and managing groups

```bash
sudo groupadd developers          # create a new group
sudo groupadd -g 2000 developers    # create it with a specific GID
sudo groupmod -n devs developers      # rename a group
sudo groupdel devs                      # delete a group (fails if it's still someone's primary group)
```

## Group membership

```bash
sudo usermod -aG developers alex          # add alex to the developers group (supplementary)
sudo gpasswd -a alex developers             # equivalent, group-focused command
sudo gpasswd -d alex developers              # remove alex from the developers group
getent group developers                        # list every member of a group
```

Every user has exactly one **primary group** (set in `/etc/passwd`, usually a private group matching their username) and any number of **supplementary groups** (listed in `/etc/group`). File permission checks consider both.

## Inspecting users and groups

```bash
id alex                  # uid, gid, and every group alex belongs to
groups alex                # just the group names
getent passwd alex           # look up a user - works with LDAP/SSSD too, unlike grep /etc/passwd
getent group developers        # same, for groups
whoami                           # the current user
who                                 # who's logged in right now, and from where
w                                     # who's logged in, plus what they're currently running
last                                    # login history (reads /var/log/wtmp)
```

## Switching users and sudo basics

```bash
su - alex               # switch to alex, loading their full login environment (the - matters)
su alex                   # switch but keep the current shell environment - usually not what you want
sudo -i                     # get a root login shell, with root's own environment
sudo -u alex whoami           # run a single command as another user, then return
sudo -l                         # list what the current user is allowed to run with sudo
sudo visudo                        # safely edit /etc/sudoers - validates syntax before saving
```

```text
# a typical /etc/sudoers line, added via visudo
alex ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart nginx
```

`visudo` locks the file and checks syntax before writing it back - editing `/etc/sudoers` directly with a normal editor risks a typo that locks out `sudo` for everyone, including you.

## Password aging and account expiry

```bash
sudo chage -l alex                 # show current aging settings for the account
sudo chage -M 90 alex                # force a password change every 90 days
sudo chage -W 7 alex                   # warn 7 days before expiry
sudo chage -E 2026-12-31 alex             # expire (disable) the account on a specific date
sudo chage -E -1 alex                       # remove an expiry date
```

## Common recipes

```bash
# Create a new admin user with sudo access in one go
sudo useradd -m -s /bin/bash -G sudo newadmin
sudo passwd newadmin

# Find every user in a specific group
getent group docker

# Find every user with UID >= 1000 (regular human accounts, not system accounts)
awk -F: '$3 >= 1000 {print $1}' /etc/passwd

# Immediately disable a compromised or departing employee's account
sudo passwd -l jsmith
sudo chage -E 0 jsmith

# Confirm a user actually landed in the group you just added them to
groups alex
```

## Safety notes

- After `usermod -aG`, the change doesn't apply to sessions the user already has open - they need to log out and back in (or run `newgrp groupname`) before it takes effect. A common "it's not working" report is really just a stale login session.
- Never use `usermod -G` (without `-a`) unless you mean to **replace** every supplementary group at once - it's a frequent way to accidentally strip a user out of groups they still need.
- `userdel` without `-r` leaves the home directory behind - fine if you might need the data later, but it also leaves files owned by a now-nonexistent UID, which can confuse future audits if that UID gets reassigned to someone else.
- Always edit `/etc/sudoers` with `visudo`, never a plain text editor - a syntax error saved directly can leave the system with no working `sudo` at all, recoverable only via single-user mode or a root console.
- Locking an account (`passwd -l` / `usermod -L`) blocks password login but does **not** revoke an already-active SSH key or an existing logged-in session - pair it with `pkill -u username` and disabling their SSH keys if you need a hard, immediate cutoff.
