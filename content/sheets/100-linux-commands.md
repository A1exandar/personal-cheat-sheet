+++
title = "My Selection 100 Essential Linux Commands Cheat Sheet"
date = 2026-09-05
description = "A curated selection of 100 essential Linux commands for sysadmins and power users, grouped by category with practical examples and safety notes."
tags = ["linux", "cli", "sysadmin", "reference"]
+++

A curated, personal selection of 100 essential Linux commands, grouped by category, with a one-line purpose, a practical example, and a note on flags, common usage, or safety for each. Meant as a fast lookup, not a tutorial — pair it with `man <command>` or `<command> --help` when you need the full picture.

## System Monitoring & Performance

### 1. `top`
Live, full-screen view of running processes and overall CPU/memory usage.
```bash
top -o %CPU
```
Press `q` to quit, `k` to kill a process by PID from inside `top`.

### 2. `htop`
An interactive, color, mouse-friendly alternative to `top`, with a process tree view.
```bash
htop -t
```
Not always preinstalled; usually one of the first packages worth adding to a new box.

### 3. `atop`
An advanced monitor that logs system activity to disk, so you can review resource use from a specific point in the past.
```bash
sudo atop -r /var/log/atop/atop_$(date +%Y%m%d)
```
Useful for "what was hammering the CPU at 3am" investigations, if the `atop` logging service was already running.

### 4. `vmstat`
Reports memory, process, paging, block I/O, and CPU activity as periodic samples.
```bash
vmstat 2 5
```
The first line of output reflects averages since boot — the samples after it are the real live numbers.

### 5. `iotop`
Shows disk I/O per process, similar to how `top` shows CPU per process.
```bash
sudo iotop -oPa
```
Requires root (it reads kernel I/O accounting); `-o` limits the view to processes actually doing I/O.

### 6. `iostat`
Reports CPU utilization alongside per-device disk I/O statistics.
```bash
iostat -xz 2
```
`-x` gives extended stats (including `%util`), `-z` hides idle devices so the output stays readable.

### 7. `free`
Summarizes total, used, and available RAM and swap.
```bash
free -h
```
"Available" (not "free") is the number that actually matters — the kernel uses spare RAM for cache that it will happily give back to applications.

### 8. `uptime`
Shows how long the system has been running plus the 1/5/15-minute load averages.
```bash
uptime
```
Compare the load average to the number of CPU cores to judge whether the system is actually under pressure.

### 9. `sar`
Collects and reports historical system activity (CPU, memory, disk, network) rather than just a live snapshot.
```bash
sar -u 1 5
```
Needs the `sysstat` package's data-collection cron job enabled ahead of time to have anything to report on.

### 10. `ps`
Prints a snapshot of currently running processes.
```bash
ps aux --sort=-%mem | head
```
`ps aux` (BSD-style) and `ps -ef` (UNIX-style) show mostly the same data with different columns — pick one and stick with it.

### 11. `pstree`
Displays running processes as a tree, showing parent/child relationships.
```bash
pstree -p
```
`-p` adds PIDs, which is what you actually want when tracking down what spawned a runaway process.

### 12. `w`
Shows who is currently logged in, what they're running, and the system load.
```bash
w
```
A more detailed cousin of `who`; the load-average column matches what `uptime` reports.

### 13. `last`
Shows login history sourced from `/var/log/wtmp`.
```bash
last -n 10
```
Useful for an audit trail of who logged in, from where, and for how long; `last reboot` shows reboot history specifically.

### 14. `glances`
A cross-platform monitoring dashboard that combines CPU, memory, disk, and network stats in one view, with optional export to InfluxDB/Prometheus.
```bash
glances
```
`nmon` is a similar, older alternative with a more classic sysadmin-era interface if `glances` isn't available.

## Networking & Connectivity

### 15. `ip`
The modern tool for managing interfaces, addresses, and routes — the replacement for `ifconfig` and `route`.
```bash
ip -br addr
```
`ip addr`, `ip link`, and `ip route` are the three subcommands worth learning first.

### 16. `ss`
Shows socket statistics — which processes are listening on or connected to which ports.
```bash
ss -tulpn
```
The direct, faster replacement for `netstat`; `-tulpn` covers TCP/UDP listeners with process names and PIDs.

### 17. `netstat`
The older tool for showing network connections, routing tables, and interface statistics.
```bash
netstat -rn
```
Still common in existing scripts and documentation, but treat `ss` as the first choice on systems that have it.

### 18. `ping`
Sends ICMP echo requests to test whether a host is reachable and measure latency.
```bash
ping -c 4 8.8.8.8
```
Always pass `-c` in scripts — without it, `ping` runs forever.

### 19. `traceroute`
Shows the network path (hop by hop) that packets take to a destination.
```bash
traceroute google.com
```
`mtr` combines `traceroute` and `ping` into one continuously-updating live view, which is usually more useful interactively.

### 20. `iftop`
A live, per-connection view of bandwidth usage on an interface.
```bash
sudo iftop -i eth0
```
Good for answering "which connection is saturating this link right now?" in real time.

### 21. `nc`
"Netcat" — a raw TCP/UDP client and server, useful for testing ports or moving data quickly.
```bash
nc -zv host 22
```
`-z` does a zero-I/O connection scan (a quick port check) instead of opening a full session.

### 22. `dig`
Performs DNS lookups and shows detailed, structured resolver output.
```bash
dig +short A linuxblog.io
```
`host` gives terser output for the same query, and `nslookup` is an older, cross-platform alternative — all three answer the same basic question.

### 23. `wget`
Downloads files over HTTP(S) and FTP, with good support for resuming interrupted downloads.
```bash
wget -c https://example.com/file.iso
```
`-c` resumes a partial download instead of restarting from zero.

### 24. `curl`
A general-purpose tool for transferring data over HTTP(S) and many other protocols — the standard tool for API testing and scripting.
```bash
curl -sI https://example.com
```
`-I` fetches headers only; `-s` silences the progress meter, which is what you usually want inside a script.

### 25. `ssh`
Opens a secure, encrypted remote shell session.
```bash
ssh -J bastion user@private-host
```
`-J` chains through a jump/bastion host in one command instead of hopping manually.

### 26. `scp`
Copies files between hosts over SSH.
```bash
scp file.tgz user@host:/tmp/
```
Fine for one-off transfers; for anything repeated or resumable, use `rsync` instead.

### 27. `rsync`
Synchronizes files and directories, transferring only the parts that changed.
```bash
rsync -aHAX --delete src/ dest/
```
> `--delete` removes files in `dest/` that no longer exist in `src/`. Run once without `--delete` (or with `--dry-run`) to confirm what would happen before using it for real.

### 28. `tcpdump`
Captures network traffic directly from an interface for protocol-level troubleshooting.
```bash
sudo tcpdump -ni eth0 port 443
```
Always filter by host/port on a busy interface — an unfiltered capture is a firehose of unrelated traffic.

## File and Directory Operations & Disk Usage

### 29. `ls`
Lists the contents of a directory.
```bash
ls -lahtr
```
`-lahtr`: long format, human-readable sizes, hidden files, sorted by time, reversed (oldest first, newest last).

### 30. `cd`
Changes the current working directory. It's a shell builtin, not a separate binary.
```bash
cd -
```
`cd -` toggles back to the previous directory — handy for bouncing between two locations.

### 31. `cp`
Copies files or directories.
```bash
cp -a src/ dest/
```
`-a` (archive) preserves permissions, ownership, timestamps, and symlinks — usually what you actually want for a full copy.

### 32. `mv`
Moves or renames files and directories.
```bash
mv report.txt report.txt.bak
```
`mv` across filesystems copies then deletes the source; within the same filesystem it's a fast metadata-only rename.

### 33. `rm`
Deletes files or directories.
```bash
rm -i *.tmp
```
> There is no undo and no trash can. `-i` prompts before each deletion; double-check the target path (especially with `-r`/`-f` and wildcards) before running it, and never run `rm -rf` with a variable path you haven't verified.

### 34. `mkdir`
Creates directories.
```bash
mkdir -p a/b/c
```
`-p` creates any missing parent directories and doesn't error if the target already exists.

### 35. `touch`
Creates an empty file if it doesn't exist, or updates a file's access/modification timestamps if it does.
```bash
touch placeholder.txt
```
Often used to create marker/lock files in scripts.

### 36. `df`
Reports disk space usage per mounted filesystem.
```bash
df -hT
```
`-h` for human-readable sizes, `-T` to also show the filesystem type.

### 37. `du`
Reports disk usage of files and directories — for finding what's actually consuming space.
```bash
du -sh * | sort -h
```
`-s` summarizes each argument instead of listing every file underneath it.

### 38. `ncdu`
An interactive, navigable version of `du` — browse, sort, and delete straight from the interface.
```bash
ncdu /var
```
Often faster than squinting at a wall of `du -h` output; not installed by default on most minimal images, worth adding.

### 39. `find`
Searches for files by name, type, size, modification time, owner, or permissions, and can act on the results.
```bash
find . -name '*.log' -mtime +30 -delete
```
> `-delete` is permanent. Run the same `find` without `-delete` first to confirm exactly which files it matches.

### 40. `locate`
Finds files instantly by name using a prebuilt index instead of walking the filesystem live.
```bash
locate sshd_config
```
Faster than `find` for name lookups, but only as current as the last `updatedb` run.

### 41. `tar`
Creates and extracts archive files, usually combined with a compressor.
```bash
tar -czvf backup.tar.gz /etc/
```
`c`reate, `z` (gzip), `v`erbose, `f`ile — the classic combo; swap `-x` for `-c` to extract.

### 42. `gzip`
Compresses a single file (replacing it with a `.gz` version).
```bash
gzip -9 large.log
```
`-9` is maximum compression at the cost of speed; `bzip2` compresses tighter than `gzip` but slower, and `xz` compresses tighter still.

### 43. `zip`
Creates `.zip` archives — the format to reach for when the recipient is on Windows or macOS.
```bash
zip -r archive.zip folder/
```
`unzip archive.zip` extracts it; `-r` is required to include a directory's contents recursively.

### 44. `ln`
Creates hard or symbolic links between files.
```bash
ln -s /opt/app/current /var/app
```
`-s` makes a symbolic link (the common case) — a hard link (no flag) only works within the same filesystem and doesn't work on directories.

### 45. `file`
Identifies a file's actual type by inspecting its content, not just its extension.
```bash
file mystery.bin
```
Useful for figuring out what an unlabeled or misnamed file actually is before opening it.

### 46. `stat`
Shows detailed metadata about a file: size, permissions, owner, timestamps, and inode number.
```bash
stat /etc/hosts
```
Good for troubleshooting permission or "why did this file's mtime change" questions in more detail than `ls -l`.

## Process, Service & Job Management

### 47. `systemctl`
The main control tool for `systemd` — start, stop, enable, and inspect services.
```bash
systemctl status nginx
```
`enable`/`disable` control whether a service starts at boot; `start`/`stop` control it right now — they're independent.

### 48. `journalctl`
Queries the systemd journal — the centralized log systemd-based systems collect.
```bash
journalctl -u nginx -f
```
`-u` filters to one unit, `-f` follows new entries live, similar to `tail -f` on a traditional log file.

### 49. `kill`
Sends a signal to a process by PID — by default `SIGTERM`, a polite request to shut down.
```bash
kill -HUP 1234
```
> `kill -9` (`SIGKILL`) cannot be caught or ignored by the process, so it skips cleanup — use it only after a normal `kill` has failed to stop the process.

### 50. `killall`
Sends a signal to processes by name instead of PID.
```bash
killall -HUP nginx
```
`pkill` does the same by pattern match (`pkill -f 'python bad_script.py'`) — both are quicker than looking up a PID with `ps` first, but double-check the pattern isn't broader than intended.

### 51. `nice`
Starts a command with an adjusted CPU scheduling priority.
```bash
nice -n 19 ./slow-job.sh
```
Lower niceness values mean higher priority; `renice` changes the priority of a process that's already running.

### 52. `nohup`
Runs a command so it keeps running after you log out, immune to the hangup signal.
```bash
nohup ./long.sh > out.log 2>&1 &
```
Output is redirected to `nohup.out` by default if you don't redirect it yourself; combine with `&` to background it.

### 53. `screen`
Keeps a shell session alive on a remote server even after you disconnect.
```bash
screen -S work
```
Detach with `Ctrl+A` then `D`; reattach later with `screen -r work`.

### 54. `tmux`
A modern terminal multiplexer — panes, windows, and persistent sessions, scriptable.
```bash
tmux new -s dev
```
Functionally similar to `screen` but more actively developed; pick one of the two and get comfortable with it.

### 55. `crontab`
Edits the current user's scheduled recurring jobs, managed by the `cron` daemon.
```bash
crontab -e
```
`crontab -l` lists the current jobs; `crontab -r` deletes them all immediately with no confirmation, so back up with `crontab -l > backup.txt` first if in doubt.

### 56. `at`
Schedules a command to run once, at a specific future time.
```bash
echo './task.sh' | at now + 2 hours
```
The one-shot counterpart to `cron`'s recurring schedule; list pending jobs with `atq`.

### 57. `sleep`
Pauses execution for a given duration.
```bash
sleep 5m
```
Accepts a bare number of seconds or a suffix (`s`, `m`, `h`, `d`); commonly used as glue between steps in a script.

### 58. `wait`
Blocks until background jobs started in the current shell finish.
```bash
./a.sh & ./b.sh & wait
```
Essential for running steps in parallel in a script while still waiting for all of them before continuing.

### 59. `dmesg`
Prints messages from the kernel's ring buffer — hardware events, driver messages, out-of-memory kills.
```bash
sudo dmesg -wH
```
`-w` follows new messages live, `-H` makes timestamps and output human-readable.

### 60. `lsof`
Lists open files, sockets, and devices, and which process holds each one.
```bash
lsof -i :80
```
`-i :80` answers "what's listening on port 80?"; useful whenever something claims a resource is "already in use."

### 61. `strace`
Traces the system calls and signals a running program makes.
```bash
strace -f -e trace=openat ./app
```
The tool of last resort when a program misbehaves and its own logs don't explain why — shows exactly what it asked the kernel for.

### 62. `watch`
Repeatedly runs a command and displays its output full-screen, refreshing on an interval.
```bash
watch -n 1 'free -h'
```
A lightweight, poor-man's live dashboard for any command that doesn't have its own.

## Users, Permissions & Ownership

### 63. `sudo`
Runs a single command as another user — normally root — with your own password (or none, per policy).
```bash
sudo -i
```
`sudo -i` opens an interactive root shell; prefer running individual commands with `sudo` over staying in a root shell longer than necessary.

### 64. `passwd`
Changes a user's password.
```bash
sudo passwd alice
```
Run without `sudo` and no username to change your own password.

### 65. `useradd`
Creates a new user account.
```bash
sudo useradd -m -s /bin/bash alice
```
`-m` creates a home directory, `-s` sets the login shell — both are easy to forget and leave you with a broken account otherwise.

### 66. `usermod`
Modifies an existing user account — shell, group membership, home directory, expiry.
```bash
sudo usermod -aG sudo alice
```
`-aG` **appends** to a group; leaving off `-a` replaces all of a user's supplementary groups, which can silently remove existing access.

### 67. `userdel`
Deletes a user account.
```bash
sudo userdel -r alice
```
> `-r` also removes the user's home directory and mail spool. Confirm you have what you need from that data before running it — this cannot be undone.

### 68. `chmod`
Changes a file's permission bits, using numeric (`755`) or symbolic (`u+x`) notation.
```bash
chmod +x deploy.sh
```
`chmod -R` applies one mode to an entire tree; directories and files usually need different modes, so a single recursive mode can leave files executable that shouldn't be, or directories missing the traversal bit they need.

### 69. `chown`
Changes the owner (and optionally group) of a file or directory.
```bash
sudo chown -R www-data:www-data /var/www
```
> Recursive ownership changes in shared or system paths (`/`, `/etc`, `/usr`, `/var`) can break services that expect specific ownership — scope `-R` to the exact directory you intend to change.

### 70. `umask`
Sets the default permission mask applied to newly created files and directories in the current shell.
```bash
umask 027
```
Applies going forward only — it doesn't change permissions on files that already exist.

### 71. `chroot`
Runs a process with a different directory treated as its apparent filesystem root.
```bash
sudo chroot /mnt/rescue /bin/bash
```
A building block for isolation (used long before containers existed); commonly used from rescue media to repair a system that won't boot.

### 72. `id`
Prints the user ID, group ID, and group memberships for a user.
```bash
id www-data
```
The quickest way to answer "why can't this account read/write that file?" — compare its groups against the file's owning group.

## Text Viewing, Editing & Shell Tools

### 73. `cat`
Prints one or more files to standard output, or concatenates them together.
```bash
cat /etc/os-release
```
Fine for short files; for anything longer than a screen, use `less` instead.

### 74. `less`
Pages through a file's contents interactively without loading it all into memory at once.
```bash
less +F /var/log/syslog
```
Search with `/pattern`, quit with `q`; `+F` starts in follow mode, similar to `tail -f`.

### 75. `tac`
Prints a file's lines in reverse order — `cat` spelled backwards, and it does the opposite.
```bash
tac access.log | head
```
Handy for showing the most recent lines of a log first without waiting for `tail` and re-sorting; `more`, a simpler and older pager than `less`, is a separate tool worth knowing but rarely needed once `less` is available.

### 76. `tail`
Shows the last lines of a file.
```bash
tail -fn 100 /var/log/nginx/error.log
```
`-f` follows the file as new lines are written — the standard way to watch a log live.

### 77. `head`
Shows the first lines of a file (10 by default).
```bash
ps aux | head -20
```
Useful for previewing the start of a large file or a long pipeline's output.

### 78. `grep`
Searches text for lines matching a pattern.
```bash
grep -rIn 'TODO' src/
```
`-r` recurses into directories, `-I` skips binary files, `-n` shows line numbers, `-i` ignores case, `-E` enables extended regular expressions.

### 79. `awk`
A pattern-scanning and text-processing language, well suited to column-based data.
```bash
awk '{sum+=$3} END{print sum}' access.log
```
Once its column ($1, $2, …) model clicks, it becomes a weekly tool for reshaping log and report data.

### 80. `sed`
A stream editor for find-and-replace and other line-based transformations.
```bash
sed -i 's/old/new/g' config.yml
```
`-i` edits the file in place — consider `sed -i.bak` to keep a backup, or test without `-i` first to preview the change.

### 81. `cut`
Extracts columns or fields from each line of input.
```bash
cut -d: -f1 /etc/passwd | sort | uniq
```
`sort` (order lines) and `uniq` (collapse adjacent duplicates) are its constant companions; `sort | uniq -c | sort -rn` is a near-universal "count and rank" idiom.

### 82. `xargs`
Builds and runs commands using items read from standard input.
```bash
find . -name '*.log' | xargs -r rm
```
The usual bridge between "a list of things" (often from `find` or `grep -l`) and "a command run on each one"; `-r` avoids running the command at all if the input is empty.

### 83. `vim`
A modal text editor available on nearly every Unix-like system.
```bash
vim +/ERROR app.log
```
The bare minimum to survive: `i` to insert, `Esc` to leave insert mode, `:wq` to save and quit, `:q!` to quit without saving. `vi` is the original, more limited ancestor `vim` is usually aliased to.

### 84. `nano`
A modeless, beginner-friendly text editor with its commands shown at the bottom of the screen.
```bash
sudo nano /etc/nginx/nginx.conf
```
A reasonable default for quick config edits when you don't want to deal with `vim`'s modes.

### 85. `man`
Displays the manual page for a command — the authoritative (if dense) reference.
```bash
man tar
```
`apropos <keyword>` searches man page descriptions when you know what you want to do but not which command does it.

### 86. `tldr`
Shows short, example-driven usage summaries for common commands, community-maintained.
```bash
tldr tar
```
A practical complement to `man` when you just want to see how a command is normally used, not read every option.

### 87. `history`
Shows the current shell's command history.
```bash
history | grep docker
```
`!123` reruns history entry 123; interactive search with `Ctrl+R` is usually faster than scrolling.

### 88. `alias`
Defines a shortcut for a longer command.
```bash
alias ll='ls -lahtr'
```
Add the ones you use often to `~/.bashrc` or `~/.zshrc` so they persist across sessions.

### 89. `env`
Shows or temporarily modifies environment variables for a command.
```bash
env FOO=bar ./app
```
`env` with no arguments prints the current environment — useful for debugging "why isn't this variable set" issues.

### 90. `clear`
Clears the terminal screen.
```bash
clear
```
`Ctrl+L` does the same thing without leaving the keyboard.

## Disks, Partitions & Devices

### 91. `mount`
Attaches a filesystem to a directory (a mount point) so it becomes accessible.
```bash
sudo mount /dev/sdb1 /mnt/data
```
Run with no arguments to list everything currently mounted; `umount /mnt/data` detaches it again (and will refuse if something is still using it).

### 92. `lsblk`
Shows a tree view of block devices — disks, partitions, and how they're mounted.
```bash
lsblk -f
```
`-f` adds filesystem type, label, and UUID — usually the first command to run when a new disk shows up.

### 93. `blkid`
Shows block device attributes: UUIDs, labels, and filesystem types.
```bash
sudo blkid
```
The values you look up when writing a `UUID=`-based entry in `/etc/fstab`.

### 94. `fdisk`
An interactive partition editor for MBR and GPT disks.
```bash
sudo fdisk -l
```
`-l` just lists partitions non-interactively; entering the interactive editor on the wrong device can destroy that disk's partition table, so always confirm the device name first.

### 95. `mkfs`
Creates a filesystem on a partition or block device.
```bash
sudo mkfs.ext4 -L data /dev/sdb1
```
> This erases any existing data on the target. Double- and triple-check the device path — `mkfs` on the wrong disk is unrecoverable without a backup.

### 96. `fsck`
Checks a filesystem for errors and attempts to repair them.
```bash
sudo fsck -f /dev/sdb1
```
The filesystem should be unmounted first; for a system's root filesystem, run it from rescue media rather than the live system.

### 97. `lspci`
Lists PCI devices attached to the system.
```bash
lspci | grep -i network
```
Useful when troubleshooting whether the kernel even sees a network card, GPU, or storage controller.

### 98. `dd`
Copies data at the block level — used for disk images, cloning drives, and raw benchmarking.
```bash
sudo dd if=disk.img of=/dev/sdX bs=4M status=progress
```
> Get `of=` wrong and you overwrite the wrong device with no warning and no undo. Always double-check both `if=` and `of=` — including with `lsblk`, right before running it.

## Bonus: Power-User Add-ons

### 99. `btop`
A modern, graphical-in-the-terminal resource monitor — an actively developed successor to tools like `htop`.
```bash
sudo apt install btop
```
Not installed by default on most systems; installing it is one of the first things worth doing on a box you'll work on regularly (`dnf install btop` / `pacman -S btop` on other distributions).

### 100. `fd`
A friendlier alternative to `find`, with sane defaults: respects `.gitignore`, colorized output, and simpler syntax.
```bash
fd -e log
```
`-e log` finds all `.log` files recursively; often packaged as `fd-find` with the binary itself named `fdfind` on Debian/Ubuntu.

## Safety reminders

- **Read a command before running it with `sudo`.** Elevated privileges remove the safety net that normal file permissions would otherwise give you.
- **Never run a destructive command (`rm`, `dd`, `mkfs`, `fsck`, recursive `chmod`/`chown`) without double-checking the exact target path.** A wrong path or device name here is rarely recoverable.
- **Use `man <command>` or `<command> --help` for anything unfamiliar**, especially before combining flags you haven't used together before.
- **Test unfamiliar or destructive commands on a non-production system first** — a VM, a container, or a scratch directory — before running them against something that matters.
- **Package manager and command names shown here (`apt`, `dnf`, `pacman`) vary by distribution.** Confirm the equivalent for the system you're actually on rather than assuming one is universal.
