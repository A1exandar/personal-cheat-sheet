+++
title = "Triggering a Job When a File Arrives with systemd Path Units"
date = 2026-11-03
description = "Processing CSV files the moment they land in /srv/incoming on RHEL 10, with a .path unit instead of a cron job that checks every five minutes: DirectoryNotEmpty= and a half-written file it picked up, the .part upload pattern, PathExistsGlob=, a stuck file that hit the start limit and silently disabled the watcher, and a script that moves bad files aside."
tags = ["linux", "rhel", "systemd", "automation", "scheduling", "sysadmin"]
+++

**Goal:** another system drops CSV reports into `/srv/incoming` - over SFTP, for example. Each report has to be checked, logged with a checksum and moved to `/srv/processed` as soon as it arrives, not up to five minutes later, as with a cron job that checks every five minutes.

**What a path unit does:** a `.path` unit watches a file or directory through the kernel's inotify interface and starts a service when something happens there. Nothing polls in a loop, and nothing runs while the directory stays empty. `process-incoming.path` starts `process-incoming.service` by default - the same naming rule as for timers.

**Tested on:** RHEL 10.2 with systemd 257. Everything below runs as root (or with `sudo`), and every command and output comes from that run.

## 1. The processing script

The service does the work, so start with the script. It handles **every** matching file it finds, not just one - section 3 shows why:

```bash
sudo mkdir -p /srv/incoming /srv/processed
sudo vim /usr/local/bin/process-incoming.sh
```

```bash
#!/bin/bash
# Move every finished .csv from /srv/incoming to /srv/processed, logging a checksum.
shopt -s nullglob
for f in /srv/incoming/*.csv; do
    lines=$(wc -l < "$f")
    sum=$(sha256sum "$f" | cut -c1-12)
    mv "$f" /srv/processed/
    echo "processed $(basename "$f") lines=$lines sha256=$sum"
done
```

```bash
sudo chmod 755 /usr/local/bin/process-incoming.sh
```

`shopt -s nullglob` makes the loop do nothing when there's no `.csv` file. Without it, Bash would run the loop once with the literal text `/srv/incoming/*.csv`.

## 2. The service and the path unit

```bash
sudo vim /etc/systemd/system/process-incoming.service
```

```ini
[Unit]
Description=Process files dropped into /srv/incoming

[Service]
Type=oneshot
ExecStart=/usr/local/bin/process-incoming.sh
```

The service has no `[Install]` section, like the service in the [systemd timer lab](/labs/systemd-timer-instead-of-cron/). It's never enabled on its own - the path unit starts it.

```bash
sudo vim /etc/systemd/system/process-incoming.path
```

```ini
[Unit]
Description=Watch /srv/incoming for new files

[Path]
DirectoryNotEmpty=/srv/incoming
MakeDirectory=yes

[Install]
WantedBy=multi-user.target
```

- `DirectoryNotEmpty=` - starts the service whenever the directory contains anything. Section 4 replaces it with something better.
- `MakeDirectory=yes` - creates the directory if it doesn't exist, so the watch doesn't fail after someone deletes it.

Enable the **path** unit, not the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now process-incoming.path
systemctl status process-incoming.path
```

```text
● process-incoming.path - Watch /srv/incoming for new files
     Loaded: loaded (/etc/systemd/system/process-incoming.path; enabled; preset: disabled)
     Active: active (waiting) since Tue 2026-11-03 19:48:33 UTC; 3ms ago
```

`active (waiting)` means the watch is in place.

## 3. Drop a file in

Write a test file somewhere else, then move it in:

```bash
printf 'id,amount\n1,100\n2,250\n' > /tmp/report-01.csv
sudo mv /tmp/report-01.csv /srv/incoming/
sleep 2
ls /srv/incoming /srv/processed
journalctl -u process-incoming.service -o cat | tail -3
```

```text
/srv/incoming:

/srv/processed:
report-01.csv
processed report-01.csv lines=3 sha256=cf1d85699d2a
process-incoming.service: Deactivated successfully.
Finished process-incoming.service - Process files dropped into /srv/incoming.
```

The file was processed within the two seconds. Five more files moved in quickly one after another were also all processed. While the service is running, the path unit doesn't start it again. When the service finishes and the directory still isn't empty, it starts it once more - which is why the script has to handle every file it finds, not only the one that triggered it.

## 4. The half-written file

The test above moved a finished file into the directory. A real upload writes the file directly into `/srv/incoming`, a piece at a time. To simulate a slow upload, write the header, wait three seconds, then write the rest:

```bash
( echo 'id,amount'; sleep 3; echo '1,100'; echo '2,250' ) | sudo tee /srv/incoming/report-02.csv > /dev/null
journalctl -u process-incoming.service -o cat | grep report-02
cat /srv/processed/report-02.csv
```

```text
processed report-02.csv lines=1 sha256=0cfb8bf36572
id,amount
1,100
2,250
```

**The file was processed after the first line.** The directory stopped being empty the moment the file was created, so the script logged `lines=1` and a checksum of the header alone, and moved the file while the upload was still writing into it. The rest of the data still ended up in the file in `/srv/processed`, but the log line describes a file that never existed. With a real processing step - importing the rows into a database, for example - two rows would simply be missing.

The usual fix is on the sender's side: upload to a temporary name like `report-02.csv.part`, and rename it to `.csv` when the upload is complete. A rename within the same filesystem is atomic, so the `.csv` file appears complete, all at once. The script already only looks at `*.csv`.

That breaks `DirectoryNotEmpty=`, though. A `.part` file makes the directory non-empty, so the service starts, finds no `.csv`, exits - and the directory still isn't empty:

```bash
echo 'id' | sudo tee /srv/incoming/report-03.csv.part > /dev/null
sleep 4
systemctl status process-incoming.path | grep Active
journalctl -u process-incoming.service -u process-incoming.path -o cat | tail -4
```

```text
     Active: failed (Result: unit-start-limit-hit) since Tue 2026-11-03 19:48:59 UTC; 3s ago
process-incoming.service: Start request repeated too quickly.
process-incoming.service: Failed with result 'start-limit-hit'.
Failed to start process-incoming.service - Process files dropped into /srv/incoming.
process-incoming.path: Failed with result 'unit-start-limit-hit'.
```

The service was started 5 times within a few seconds and hit systemd's default start limit - 5 starts in 10 seconds. With that, the **path unit failed too**, and stopped watching the directory.

Watch for the files that are actually ready instead, with `PathExistsGlob=`:

```ini
[Path]
PathExistsGlob=/srv/incoming/*.csv
MakeDirectory=yes
```

This starts the service while at least one file matches `*.csv`, and ignores everything else. After the change, both failed units have to be cleared - resetting only the path unit isn't enough, because the service is still blocked by its start limit:

```bash
sudo rm /srv/incoming/report-03.csv.part
sudo systemctl daemon-reload
sudo systemctl reset-failed process-incoming.path process-incoming.service
sudo systemctl restart process-incoming.path
```

The same slow upload, now with a `.part` name and a rename at the end:

```bash
( echo 'id,amount'; sleep 3; echo '1,100'; echo '2,250' ) | sudo tee /srv/incoming/report-04.csv.part > /dev/null \
    && sudo mv /srv/incoming/report-04.csv.part /srv/incoming/report-04.csv
journalctl -u process-incoming.service -o cat | grep report-04
systemctl is-active process-incoming.path
```

```text
processed report-04.csv lines=3 sha256=cf1d85699d2a
active
```

All three lines, and the same checksum as `report-01.csv`, which has the same content. Twenty files renamed in quick succession were all processed in just two runs of the service, and the path unit stayed `active`.

## 5. A file the script can't handle

The start limit from section 4 hits in a second way. If processing fails and the file stays in `/srv/incoming`, the glob keeps matching, the service keeps restarting, and after 5 tries the path unit fails. To test that, the script was replaced with one that only exits with code 1, and two files were dropped in:

```bash
systemctl is-active process-incoming.path
ls /srv/incoming
```

```text
failed
later.csv
stuck.csv
```

`later.csv` arrived after the path unit had failed, and nothing processed it. **One bad file stops processing for every file after it, and nothing announces it.**

The script therefore has to move every file out of `/srv/incoming`, including the ones it rejects:

```bash
#!/bin/bash
# Move every finished .csv from /srv/incoming to /srv/processed, logging a checksum.
# A file that fails the check goes to /srv/failed, so it can't trigger the unit again.
shopt -s nullglob
rc=0
for f in /srv/incoming/*.csv; do
    if [ "$(head -n1 "$f")" != "id,amount" ]; then
        mv "$f" /srv/failed/
        echo "rejected $(basename "$f"): unexpected header" >&2
        rc=1
        continue
    fi
    lines=$(wc -l < "$f")
    sum=$(sha256sum "$f" | cut -c1-12)
    mv "$f" /srv/processed/
    echo "processed $(basename "$f") lines=$lines sha256=$sum"
done
exit $rc
```

```bash
sudo mkdir -p /srv/failed
```

With one good file and one bad one:

```text
rejected bad.csv: unexpected header
processed good.csv lines=2 sha256=70b1e12cfeaa
process-incoming.service: Failed with result 'exit-code'.
```

The good file was processed, the bad one went to `/srv/failed`, and the path unit stayed `active`. The service still ends as `failed`, because the script exits with `1` - so the rejection is visible in `systemctl --failed`, and an `OnFailure=` alert like the one in the [systemd timer lab](/labs/systemd-timer-instead-of-cron/) can report it.

## 6. Files that arrive while the server is down

An enabled path unit checks its condition as soon as it starts. To test it, the path unit was stopped, a file was written into `/srv/incoming`, and the system was restarted:

```bash
sudo systemctl stop process-incoming.path
printf 'id,amount\n9,900\n' | sudo tee /srv/incoming/while-down.csv > /dev/null
sudo reboot
```

After the restart:

```bash
systemctl is-active process-incoming.path
journalctl -b -u process-incoming.service -o cat | grep processed
```

```text
active
processed while-down.csv lines=2 sha256=f482cc72c6e1
```

The file that was already waiting was processed right at boot.

## Verification

```bash
systemctl is-enabled process-incoming.path        # enabled
systemctl is-active process-incoming.path         # active
printf 'id,amount\n1,1\n' | sudo tee /srv/incoming/check.csv.part > /dev/null
sudo mv /srv/incoming/check.csv.part /srv/incoming/check.csv
sleep 2
ls /srv/processed/check.csv                       # moved
journalctl -u process-incoming.service -o cat | tail -2
```

## Safety notes

- Write files into the watched directory under a temporary name and rename them when complete. A path unit fires on the first byte, and the script can't tell a finished file from one that's still being written.
- `DirectoryNotEmpty=` keeps firing as long as *anything* is in the directory - a `.part` file, a leftover, a subdirectory. Prefer `PathExistsGlob=` for the files that are actually ready.
- The script must remove every file that triggered it, whether it succeeds or fails. A file that stays makes the service restart until it hits the start limit, and then the path unit stops watching altogether.
- After a start-limit failure, clear both units: `systemctl reset-failed name.path name.service`. Monitor with `systemctl --failed`, because a failed path unit doesn't announce itself.
- A path unit doesn't watch subdirectories. In the test, a `.csv` written to `/srv/incoming/bank-a/` was never processed. Use one `PathExistsGlob=` line per directory.
- The script runs as root. Files from another system are untrusted input - don't pass their names or contents to a shell without quoting, as `"$f"` is quoted everywhere above.
