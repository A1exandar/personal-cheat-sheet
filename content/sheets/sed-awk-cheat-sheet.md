+++
title = "sed & awk Cheat Sheet"
date = 2026-09-28
description = "Edit text streams with sed (substitution, deletion, in-place editing, addressing) and process columns with awk (fields, patterns, built-in variables, one-liners)."
tags = ["linux", "sed", "awk", "text", "sysadmin"]
+++

`sed` and `awk` are the two workhorses of line-oriented text processing in shell scripts. `sed` edits a stream line by line - substitute, delete, insert. `awk` splits each line into fields and lets you write small programs against them - sum a column, filter by a condition, reformat output.

## sed: basic substitution

```bash
sed 's/old/new/' file.txt        # replace the FIRST match per line, print to stdout
sed 's/old/new/g' file.txt        # replace EVERY match per line (g = global)
sed 's/old/new/2' file.txt        # replace only the 2nd match per line
sed 's/old/new/gi' file.txt        # global + case-insensitive
```

Without `-i`, `sed` never touches the file - it prints the edited result to stdout, so it's always safe to try a substitution first and check the output before writing it back.

## sed: editing in place

```bash
sed -i 's/old/new/g' file.txt          # edit the file directly, no output, no backup
sed -i.bak 's/old/new/g' file.txt       # edit in place, but keep file.txt.bak as a backup
sed -i 's/old/new/g' *.conf              # in-place across multiple files at once
```

On macOS/BSD `sed`, `-i` requires an explicit (even empty) suffix argument: `sed -i '' 's/old/new/g' file.txt`. GNU `sed` (default on Linux) does not.

## sed: addressing which lines to act on

```bash
sed '3d' file.txt              # delete line 3
sed '2,5d' file.txt             # delete lines 2 through 5
sed '/^#/d' file.txt             # delete every line starting with #
sed '/^$/d' file.txt              # delete every blank line
sed '3,$d' file.txt                # delete from line 3 to the end of the file
sed '/start/,/end/d' file.txt       # delete every line between a "start" and "end" match, inclusive
```

```bash
sed -n '5p' file.txt         # -n suppresses default output; p explicitly prints line 5
sed -n '10,20p' file.txt      # print only lines 10-20
sed -n '/error/p' file.txt      # print only lines matching a pattern (like grep)
sed '3!d' file.txt                # ! negates: delete every line EXCEPT line 3
```

## sed: insert, append, change

```bash
sed '3i\Inserted before line 3' file.txt    # insert a new line BEFORE line 3
sed '3a\Appended after line 3' file.txt      # insert a new line AFTER line 3
sed '3c\Replacement for line 3' file.txt      # replace the entire line 3
```

## sed: useful one-liners

```bash
sed -n '1,10p' file.txt                    # print the first 10 lines (like head)
sed -n '$p' file.txt                        # print only the last line
sed 's/[ \t]*$//' file.txt                   # strip trailing whitespace from every line
sed '/^\s*#/d;/^\s*$/d' /etc/nginx/nginx.conf  # strip comments AND blank lines in one pass
sed -n 'l' file.txt                            # show non-printing characters (tabs, line endings) visibly
```

## awk: basics - fields and print

```bash
echo "one two three" | awk '{print $2}'     # print the 2nd field (fields split on whitespace by default)
awk '{print $1, $3}' file.txt                 # print the 1st and 3rd fields, space-separated
awk '{print NF}' file.txt                       # print the number of fields on each line
awk '{print NR, $0}' file.txt                    # print each line prefixed with its line number
```

`$0` is the whole line, `$1`...`$NF` are its fields, `NR` is the current line number, `NF` is the field count on the current line.

## awk: field separators

```bash
awk -F: '{print $1}' /etc/passwd            # split on ":" instead of whitespace - print usernames
awk -F',' '{print $2}' data.csv               # split a CSV on comma
awk 'BEGIN{OFS="-"} {print $1, $2}' file.txt    # OFS controls the separator used when PRINTING fields
```

## awk: patterns and conditions

```bash
awk '$3 > 100' file.txt                 # print lines where field 3 is greater than 100 (no action = print $0)
awk '/error/ {print}' /var/log/syslog     # print lines matching a regex pattern
awk '$1 == "root" {print $0}' /etc/passwd  # print lines where field 1 exactly equals "root"
awk 'NR==1' file.txt                        # print only the first line (header)
awk 'NR>1' file.txt                          # print every line EXCEPT the first (skip a header)
```

## awk: built-in variables

```bash
awk '{print FILENAME, FNR, NR}' a.txt b.txt   # FNR resets per file, NR keeps counting across all files
awk 'BEGIN{print ENVIRON["HOME"]}'              # read environment variables
awk 'END{print NR}' file.txt                     # BEGIN runs once before input, END once after - here: count lines
```

## awk: common one-liners

```bash
awk '{sum += $1} END {print sum}' numbers.txt         # sum a column
awk '{print $NF}' file.txt                              # print the LAST field of each line ($NF, not a fixed number)
df -h | awk '{print $5, $6}'                              # combine with another command's output - disk usage %, mount point
awk '{count[$1]++} END {for (k in count) print k, count[k]}' access.log  # count occurrences per value in field 1
ps aux | awk '$3 > 50.0 {print $2, $3, $11}'                              # PID, %CPU, command for processes over 50% CPU
```

## Combining sed and awk with other tools

```bash
grep "Failed password" /var/log/auth.log | awk '{print $11}' | sort | uniq -c | sort -rn  # count failed logins by source IP
cat access.log | awk '{print $1}' | sort -u                                                # unique visitor IPs from a log
sed -n '/START/,/END/p' file.txt | awk '{print $1}'                                          # extract a block, then pull a column from it
```

## Common administration examples

```bash
# Replace a config value across every matching file, keeping a .bak of each
sed -i.bak 's/^Port 22$/Port 2222/' /etc/ssh/sshd_config

# Active nginx config only: strip comments and blank lines
sed '/^\s*#/d;/^\s*$/d' /etc/nginx/nginx.conf

# Top 10 IPs hitting a web server, from the access log
awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -10

# Extract just usernames with UID >= 1000 (regular users, not system accounts)
awk -F: '$3 >= 1000 {print $1}' /etc/passwd
```

## Safety notes

- `sed -i` overwrites the file immediately with no confirmation and no built-in undo - always test the substitution without `-i` first, or use `-i.bak` to keep a backup until you've verified the result.
- GNU `sed` (Linux) and BSD `sed` (macOS) differ on `-i`: GNU accepts `-i` alone, BSD requires a suffix argument (even `''`). Scripts meant to run on both need to account for this.
- `sed`'s basic regex mode requires escaping `+`, `?`, `|`, `(`, `)` with a backslash; use `sed -E` (extended regex, same syntax as `grep -E`) to avoid the extra escaping.
- In `awk`, `==` is a strict comparison and `$3 > 100` compares numerically only if the field looks numeric - comparing a non-numeric field this way silently does a string comparison instead, which can give surprising results on mixed data.
