+++
title = "grep Cheat Sheet"
date = 2026-08-31
description = "Search text with grep: recursive, case-insensitive, whole-word, inverse and regex matching, with /etc and log file examples."
tags = ["linux", "cli", "text", "sysadmin"]
+++

A quick reference for `grep`, the tool for searching text and filtering command output.

## Basic search

```bash
grep "text" file.txt
grep "Listen" /etc/apache2/ports.conf
```

Prints every line in the file that contains the pattern.

## -i case-insensitive

```bash
grep -i "error" /var/log/syslog
```

Matches `error`, `Error`, `ERROR` and so on.

## -n show line numbers

```bash
grep -n "PermitRootLogin" /etc/ssh/sshd_config
```

Prefixes each match with its line number, so you can jump straight to it in an editor.

## -v invert match

```bash
grep -v "^#" /etc/nginx/nginx.conf | grep -v "^$"
```

Prints lines that do *not* match. The example strips comments and blank lines to show only the active configuration.

## -r / -R recursive

```bash
grep -r "server_name" /etc/nginx/
grep -R "server_name" /etc/nginx/
```

Searches every file under a directory. `-r` follows symlinks only when they are given on the command line; `-R` follows all symlinks it encounters.

## -w whole word

```bash
grep -w "root" /etc/passwd
```

Matches `root` as a standalone word, not `chroot` or `rootkit`.

## -c count matches

```bash
grep -c "Failed password" /var/log/auth.log
```

Prints the number of matching lines instead of the lines themselves.

## -l / -L list filenames

```bash
grep -rl "PermitRootLogin yes" /etc/
grep -rL "Subsystem sftp" /etc/ssh/
```

`-l` prints only the names of files that contain a match; `-L` prints the names of files that contain no match. Useful for auditing configuration across many files.

## -o only the match

```bash
grep -oE "([0-9]{1,3}\.){3}[0-9]{1,3}" /var/log/auth.log | sort | uniq -c | sort -rn
```

Prints just the matched text, not the whole line. The example extracts IP addresses from the auth log and counts them.

## -E extended regex

```bash
grep -E "warning|error|critical" /var/log/syslog
grep -E "^(deb|deb-src) " /etc/apt/sources.list
```

Enables `+`, `?`, `|`, `()` and `{}` without backslashes. `egrep` is the old name for the same thing.

## -F fixed strings

```bash
grep -F "192.168.1.10" /etc/hosts
grep -F "[" logfile.txt
```

Treats the pattern literally, so regex metacharacters like `.` and `[` match themselves. Faster, and safer when searching for text that contains punctuation.

## Multiple patterns

```bash
grep -e "sshd" -e "sudo" /var/log/auth.log
grep -E "sshd|sudo" /var/log/auth.log
grep -f patterns.txt /var/log/syslog
```

Use repeated `-e` options, an alternation with `-E`, or `-f` to read one pattern per line from a file.

## Common administration examples

```bash
# Active configuration only, comments and blanks removed
grep -vE "^\s*(#|$)" /etc/ssh/sshd_config

# Which config files mention a deprecated option
grep -rn "ssl_protocols" /etc/nginx/

# Failed SSH logins, with context lines
grep -B1 -A1 "Failed password" /var/log/auth.log

# Follow a log and highlight matches live
tail -f /var/log/nginx/error.log | grep --color=always "error"
```
