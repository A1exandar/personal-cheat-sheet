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

## Combining with xargs

```bash
grep -rl "TODO" ~/project | xargs wc -l
grep -rlZ "DEBUG=true" /etc/myapp/ | xargs -0 sed -i 's/DEBUG=true/DEBUG=false/'
```

`xargs` is a separate tool, not a `grep` option, but the two are used together constantly: it takes the list of items `grep` prints on stdout and turns them into arguments for another command, rather than letting that output just scroll past. `grep -rl` alone only prints filenames; piped into `xargs wc -l`, those filenames become the files `wc -l` actually counts. Without `xargs`, a command like `wc -l` would just sit waiting on stdin, since `grep`'s output arrives as plain text on a pipe, not as command-line arguments the next program can act on.

> Filenames can contain spaces, newlines, or other awkward characters that break a plain pipe into `xargs`. `grep -rlZ` (the `-Z` / `--null` option) separates filenames with a NUL byte instead of a newline, and `xargs -0` reads that format - the only combination that's fully safe against spaces in filenames. Plain `grep -rl | xargs` works for simple cases but splits on whitespace too, misreading a file named `my file.txt` as two separate arguments.

## Combining with find -exec

```bash
find /var/log -name "*.log" -exec grep -l "OutOfMemory" {} \;
find /etc -name "*.conf" -exec grep -q "deprecated_option" {} \; -print
```

`-exec` belongs to `find`, not to `grep`, but the pairing is everywhere: `find` locates the files, `-exec` runs a command once per file found, with `{}` substituted for that file's path and `\;` marking where the command ends. The first example finds every `.log` file under `/var/log` and runs `grep -l` against each one in turn, printing the name of any file that actually contains the match. The second uses `grep -q` (quiet - produces no output, only a pass/fail exit status) so that `find`'s own `-print` only fires for files where the `grep` inside `-exec` found something.

> `-exec … \;` starts a brand-new `grep` process for every single file - fine for a handful of files, slow across a huge tree. `-exec … +` instead batches as many files as possible onto fewer command lines (the same idea as `xargs`), for commands that accept multiple files at once (`grep` does): `find /var/log -name "*.log" -exec grep -l "OutOfMemory" {} +` runs far fewer `grep` processes over a large directory tree and finishes noticeably faster.

## 2>/dev/null - discarding error output

```bash
grep -r "password" /etc/ 2>/dev/null
find / -name "*.conf" 2>/dev/null | xargs grep -l "ssl_protocols" 2>/dev/null
```

`2>/dev/null` is shell redirection, not a `grep` option - it's not specific to `grep` at all and works the same way after any command. Every command has three standard I/O streams: `0` (stdin, input), `1` (stdout, normal output), and `2` (stderr, error messages). `2>/dev/null` redirects stream `2` specifically to `/dev/null`, a special file that silently discards anything written to it. Searching all of `/etc/` as a normal user almost always hits a few directories only root can read; without this, `grep -r` buries the real matches under a `Permission denied` line for every one of them. Redirecting only stream `2` - not `1` - means the actual matches (sent to stdout) still print exactly as normal; only the permission errors are silenced.

> `2>/dev/null` hides *every* error on that stream, not just the expected "permission denied" one - a typo'd path, a missing file, or a genuine problem is suppressed exactly the same way. It's worth running a command once without it first, to see what's actually being thrown away, before relying on it inside a script.

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
