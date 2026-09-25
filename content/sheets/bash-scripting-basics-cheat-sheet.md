+++
title = "Bash Scripting Basics Cheat Sheet"
date = 2026-09-25
description = "Write practical Bash scripts: variables, quoting, arguments, conditionals, loops, functions, arrays, exit codes and the safety flags every script should start with."
tags = ["linux", "bash", "scripting", "sysadmin"]
+++

A practical reference for writing Bash scripts - the kind that automate a recurring task, rather than a full programming language tutorial.

## The shebang and making a script executable

```bash
#!/usr/bin/env bash   # first line of every script - finds bash on $PATH rather than assuming /bin/bash
```

```bash
chmod +x script.sh   # make it executable
./script.sh           # run it (must be in current directory, or use the full/relative path)
```

## Variables

```bash
name="Aleksandar"        # no spaces around =, or bash treats it as a command
echo "$name"              # always quote variables when reading them
echo "Hello, ${name}!"    # {} disambiguates the variable name from surrounding text
```

```bash
readonly max_retries=3   # a constant - reassigning it later is an error
unset name                 # remove a variable entirely
```

> Never put spaces around `=` in an assignment (`name = "x"` fails) - bash parses that as running a command called `name` with arguments `=` and `"x"`.

## Quoting - the single most important habit

```bash
echo $file       # unquoted - breaks on spaces/globs in $file, words get split apart
echo "$file"      # quoted - always safe, treat this as the default
```

```bash
echo 'literal $no_expansion here'   # single quotes: nothing is expanded, printed exactly as typed
echo "expands $HOME here"            # double quotes: variables and command substitution still expand
```

> Quote every variable expansion (`"$var"`, not `$var`) unless you have a specific reason not to. Unquoted variables are the single most common source of bash bugs - filenames with spaces silently break into multiple words.

## Command substitution

```bash
now=$(date +%F)               # preferred modern syntax - run a command, capture its output
count=$(ls -1 | wc -l)         # nest commands freely inside $()
echo "Today is $now, $count files here"
```

Avoid the older `` `backtick` `` syntax - `$()` nests more cleanly and is easier to read.

## Script arguments

```bash
#!/usr/bin/env bash
echo "Script name: $0"     # the script's own path
echo "First arg: $1"        # first argument
echo "Second arg: $2"       # second argument
echo "All args: $@"         # every argument, each as a separate word
echo "Arg count: $#"        # how many arguments were passed
```

```bash
./script.sh backup.tar.gz /mnt/data   # $1=backup.tar.gz, $2=/mnt/data, $#=2
```

```bash
if [ "$#" -eq 0 ]; then
    echo "Usage: $0 <source> <destination>"   # remind the caller how to use it
    exit 1                                     # non-zero = failure, stops here
fi
```

## Exit codes

```bash
exit 0   # success - the convention every tool and script should follow
exit 1   # generic failure
```

```bash
some-command
echo "exit code was: $?"   # $? holds the exit status of the LAST command run
```

```bash
command1 && command2   # run command2 only if command1 succeeded (exit code 0)
command1 || command2   # run command2 only if command1 failed (non-zero exit code)
```

## Conditionals

```bash
if [ "$name" = "admin" ]; then
    echo "Welcome, admin"
elif [ "$name" = "guest" ]; then
    echo "Limited access"
else
    echo "Unknown user"
fi
```

```bash
[[ "$path" == /var/* ]]   # [[ ]] supports pattern matching and is generally safer than [ ]
[ -f "$file" ]             # -f: is this a regular file?
[ -d "$dir" ]              # -d: is this a directory?
[ -x "$script" ]           # -x: is this executable?
[ -z "$var" ]              # -z: is this string empty?
[ -n "$var" ]              # -n: is this string non-empty?
```

```bash
if [ ! -f "$config" ]; then
    echo "Config file missing"   # ! negates the test
    exit 1
fi
```

> Prefer `[[ ]]` over `[ ]` in bash-specific scripts - it handles unquoted variables and pattern matching more safely, at the cost of not being portable to plain `/bin/sh`.

## Numeric comparisons

```bash
if [ "$count" -eq 0 ]; then echo "zero"; fi     # -eq / -ne / -lt / -le / -gt / -ge
if (( count > 10 )); then echo "over ten"; fi    # (( )) arithmetic context - more natural syntax
```

`=`/`==` compare strings; `-eq`/`-ne`/etc. compare numbers. Mixing them up (`[ "$count" == 5 ]` on a string-typed variable) is a common source of subtle bugs.

## Loops

```bash
for file in *.log; do
    echo "Processing: $file"   # loops over each matching filename
done
```

```bash
for i in {1..5}; do
    echo "Iteration $i"        # brace expansion generates 1 2 3 4 5
done
```

```bash
count=0
while [ "$count" -lt 5 ]; do
    echo "Count: $count"
    count=$((count + 1))       # arithmetic without $(( )) requires the let/expr command instead
done
```

```bash
while read -r line; do
    echo "Line: $line"          # -r: don't let backslashes be interpreted, read the line literally
done < input.txt
```

## Functions

```bash
greet() {
    local name="$1"            # local: scoped to this function, doesn't leak into the rest of the script
    echo "Hello, $name!"
}

greet "Aleksandar"              # call it like any other command
```

```bash
backup_file() {
    local source="$1"
    local dest="$2"
    if [ ! -f "$source" ]; then
        echo "Error: $source not found" >&2   # >&2 sends errors to stderr, not stdout
        return 1                                # return: exit status for a FUNCTION (exit is for the whole script)
    fi
    cp "$source" "$dest"
}
```

## Arrays

```bash
servers=("web1" "web2" "db1")   # declare an array
echo "${servers[0]}"             # first element (arrays are zero-indexed)
echo "${servers[@]}"             # every element
echo "${#servers[@]}"            # number of elements
```

```bash
for server in "${servers[@]}"; do
    echo "Checking $server"       # quoted "${servers[@]}" keeps multi-word elements intact
done
```

## Here-documents (multi-line input)

```bash
cat <<EOF
This is line one.
This is line two, with $variable expanded.
EOF
```

```bash
cat <<'EOF'
This is printed literally - $variable is NOT expanded because EOF is quoted.
EOF
```

## String basics

```bash
str="Hello World"
echo "${#str}"           # length of the string
echo "${str,,}"           # lowercase the whole string
echo "${str^^}"           # uppercase the whole string
echo "${str/World/Bash}"  # replace first match
echo "${str:0:5}"         # substring: start at 0, length 5 -> "Hello"
```

```bash
filename="backup.tar.gz"
echo "${filename%.gz}"    # strip shortest match from the end -> "backup.tar"
echo "${filename%%.*}"    # strip longest match from the end -> "backup"
```

## Safety flags every script should consider

```bash
#!/usr/bin/env bash
set -e   # exit immediately if any command fails, instead of continuing on regardless
set -u   # error on any unset variable, instead of silently treating it as empty
set -o pipefail   # a pipeline fails if ANY command in it fails, not just the last one
```

```bash
set -euo pipefail   # the three combined - a common, defensive first line for real scripts
```

> `set -e` has real edge cases (it doesn't trigger inside `if` conditions or before `&&`/`||`, for example) - it's a good default, not a guarantee. Still worth using for anything beyond a quick one-off script.

```bash
set -x   # print each command before running it - invaluable while debugging, turn off before production use
set +x   # turn tracing back off
```

## Reading user input

```bash
read -p "Enter your name: " name   # -p shows a prompt on the same line
echo "Hello, $name"
```

```bash
read -sp "Enter password: " password   # -s: silent, don't echo what's typed
echo   # newline, since -s suppresses the one the user's Enter key would normally produce
```

## Common recipes

```bash
#!/usr/bin/env bash
set -euo pipefail

# Back up a directory with a timestamped name, and confirm the source exists first
source_dir="/home/user/documents"
backup_dir="/mnt/backups"

if [ ! -d "$source_dir" ]; then
    echo "Error: $source_dir does not exist" >&2
    exit 1
fi

timestamp=$(date +%F_%H-%M-%S)
tar -czf "${backup_dir}/backup-${timestamp}.tar.gz" "$source_dir"
echo "Backup complete: backup-${timestamp}.tar.gz"
```

```bash
#!/usr/bin/env bash
# Loop over a list of servers and check if each one responds to ping
servers=("web1.example.com" "web2.example.com" "db1.example.com")

for server in "${servers[@]}"; do
    if ping -c 1 -W 2 "$server" &> /dev/null; then
        echo "$server: UP"
    else
        echo "$server: DOWN"
    fi
done
```

## Safety notes

- Quote every variable expansion (`"$var"`) - the single change that prevents the most bash bugs.
- Start real scripts with `set -euo pipefail` and add exceptions deliberately, rather than debugging silent failures later.
- Use `local` for every variable inside a function that doesn't need to be seen outside it.
- Test destructive commands (`rm`, `mv`, anything with `--delete`) with an `echo` in front while developing the script, then remove the `echo` once the logic is confirmed correct.
- Prefer `[[ ]]` and `$()` over `[ ]` and backticks in scripts that only need to run under bash specifically.
