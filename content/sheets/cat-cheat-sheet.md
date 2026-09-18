+++
title = "cat Cheat Sheet"
date = 2026-08-30
description = "Practical uses of cat for viewing files, numbering lines, revealing control characters and combining files."
tags = ["linux", "cli", "text"]
+++

A quick reference for `cat` (concatenate): print files, join them, and pipe their contents elsewhere.

## View a file

```bash
cat file.txt
```

Prints the whole file to the terminal. Good for short configuration files such as `/etc/hostname` or `/etc/resolv.conf`. For anything long, use a pager (`less file.txt`) so it does not scroll off screen.

## Number every line

```bash
cat -n file.txt
```

Prefixes each line with a line number. Handy when someone reports an error at "line 42" of a config file.

## Number non-blank lines

```bash
cat -b file.txt
```

Like `-n`, but blank lines are not counted. Useful for files with many spacer lines.

## Show hidden and control characters

```bash
cat -A file.txt
```

Displays line endings as `$`, tabs as `^I`, and other control characters in caret notation. Use it to spot Windows `\r` line endings (`^M$`), stray trailing whitespace, or tabs-vs-spaces problems that are invisible otherwise. `-A` is equivalent to `-vET`.

## Squeeze repeated blank lines

```bash
cat -s file.txt
```

Collapses runs of blank lines into a single blank line, making padded files easier to read.

## Display multiple files

```bash
cat file1 file2
cat /etc/cron.d/*
```

Prints the files back to back, in order. Useful for reviewing a set of small config fragments at once.

## Combine files into a new file

```bash
cat file1 file2 > combined.txt
```

Writes the concatenated contents to `combined.txt`, overwriting it if it exists.

## Append to a file

```bash
cat file.txt >> combined.txt
```

Adds the contents of `file.txt` to the end of `combined.txt` without erasing what is already there.

## Related commands

- **`tac`** — same as `cat` but prints lines in reverse order (last line first).
- **`head -n 20 file`** — first 20 lines only.
- **`tail -n 20 file`** — last 20 lines; `tail -f` follows a log file as it grows.

Keep `cat` for viewing and joining; reach for `head`, `tail` or `less` when a file is too large to dump in full.
