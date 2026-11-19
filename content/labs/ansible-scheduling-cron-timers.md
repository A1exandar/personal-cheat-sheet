+++
title = "Ansible on RHEL 10: Scheduling Jobs with cron, systemd Timers and at"
date = 2026-11-19
description = "The fifth lab in the Ansible series: one playbook sets up a user's crontab, a system job in /etc/cron.d with MAILTO, a user who isn't allowed to use cron, and a nightly backup as a systemd service and timer. Includes a timer that kept its old schedule while Ansible reported success, a percent sign that broke the service only when it ran, a renamed cron job that left a duplicate behind, and why one-off at jobs don't belong in a playbook."
tags = ["linux", "rhel", "ansible", "automation", "cron", "systemd", "timers", "at", "sysadmin"]
+++

**Goal:** the same scheduled jobs on `server1` and `server2`, kept in one playbook:

- `alice` gets a daily disk report at 02:30 in her own crontab
- a system job in `/etc/cron.d/` cleans up old temp files every 15 minutes, with its mail going to root
- `carol` isn't allowed to use cron
- `/etc` is archived every night at 01:00 by a systemd **timer** instead of cron

At the end: why a one-off `at` job doesn't fit in a playbook, and how to run it instead.

These are the scheduling tasks from my RHCSA practice exercises. The manual versions are in [systemd timer instead of cron](/labs/systemd-timer-instead-of-cron/) and [one-time jobs with at and batch](/labs/one-time-jobs-at-batch/).

**Starting point:** the setup from the earlier labs in this series: `server1` is the control node, the project is in `~/ansible`, both servers install packages from the ISO repositories, and the users `alice` and `carol` exist from [lab 4](/labs/ansible-users-groups-vault/).

**Lab environment:**

| Host | IP address | Role |
|---|---|---|
| `server1` | `192.168.10.10` | control node + managed node |
| `server2` | `192.168.10.11` | managed node |

The addresses are examples. Replace them with your own.

**Tested on:** CentOS Stream 10 containers with systemd (`ansible-core 2.16`, systemd 257). Every output below comes from that test. Containers don't wait until 01:00, so I tested the backup by starting the service by hand. `systemctl list-timers` confirmed the next run time.

## 1. Which module for what

| Task | Module | In `ansible-core`? |
|---|---|---|
| user crontab, `/etc/cron.d` files | `ansible.builtin.cron` | yes |
| `cron.deny` | `ansible.builtin.lineinfile` | yes |
| systemd unit files | `ansible.builtin.copy` | yes |
| enable and start a timer | `ansible.builtin.systemd_service` | yes |
| `at` jobs | `community.general.at` | **no** |

Everything except `at` works offline with nothing extra installed. Section 7 covers `at`.

## 2. The playbook

```bash
cd ~/ansible
vim schedule.yml
```

```yaml
---
- name: Scheduled jobs on every server
  hosts: servers
  become: true
  tasks:
    - name: cron and at are installed
      ansible.builtin.dnf:
        name:
          - cronie
          - at
        state: present

    - name: crond and atd are running
      ansible.builtin.systemd_service:
        name: "{{ item }}"
        state: started
        enabled: true
      loop:
        - crond
        - atd

    - name: Daily disk report for alice
      ansible.builtin.cron:
        name: daily disk report
        user: alice
        minute: "30"
        hour: "2"
        job: df -h > /home/alice/disk-report.txt

    - name: Mail for the cleanup job goes to root
      ansible.builtin.cron:
        name: MAILTO
        env: true
        job: root
        cron_file: tmp-cleanup
        user: root

    - name: Clean up old temp files every 15 minutes
      ansible.builtin.cron:
        name: clean old tmp files
        cron_file: tmp-cleanup
        user: root
        minute: "*/15"
        job: find /var/tmp -name "*.tmp" -mmin +60 -delete

    - name: carol may not use cron
      ansible.builtin.lineinfile:
        path: /etc/cron.deny
        line: carol
        create: true
        mode: "0600"

    - name: Backup service
      ansible.builtin.copy:
        dest: /etc/systemd/system/backup-etc.service
        content: |
          [Unit]
          Description=Archive /etc to /var/backups

          [Service]
          Type=oneshot
          ExecStart=/usr/bin/bash -c "mkdir -p /var/backups && tar -czf /var/backups/etc-$(date +%%F).tar.gz /etc"

    - name: Backup timer
      ansible.builtin.copy:
        dest: /etc/systemd/system/backup-etc.timer
        content: |
          [Unit]
          Description=Archive /etc every night

          [Timer]
          OnCalendar=*-*-* 01:00:00
          Persistent=true

          [Install]
          WantedBy=timers.target

    - name: The unit files are valid
      ansible.builtin.command: systemd-analyze verify /etc/systemd/system/backup-etc.service /etc/systemd/system/backup-etc.timer
      changed_when: false

    - name: Backup timer is enabled and running
      ansible.builtin.systemd_service:
        name: backup-etc.timer
        state: started
        enabled: true
        daemon_reload: true
```

How to read the cron tasks:

- **`name`** is how the module finds its own entry later. It writes it as a comment above the job (`#Ansible: daily disk report`) and, on every run, looks for that comment to decide whether to add a job or update it. Section 5 shows why it matters.
- **`user: alice`** edits `alice`'s own crontab, the same as `crontab -e -u alice`.
- **`cron_file: tmp-cleanup`** writes `/etc/cron.d/tmp-cleanup` instead of a user's crontab. Lines in `/etc/cron.d` have an extra field for the user the job runs as, so `user` is required here.
- **`env: true`** writes a variable instead of a job: `name` is the variable, `job` is its value.
- Fields you leave out (`day`, `month`, `weekday`) default to `*`.

The timer tasks are explained in sections 4 and 6.

## 3. Run it

```bash
ansible-playbook --syntax-check schedule.yml
ansible-playbook schedule.yml
```

The first run on a fresh server:

```
TASK [cron and at are installed] ***********************************************
changed: [server1]

TASK [crond and atd are running] ***********************************************
changed: [server1] => (item=crond)
changed: [server1] => (item=atd)

TASK [Daily disk report for alice] *********************************************
changed: [server1]

TASK [Mail for the cleanup job goes to root] ***********************************
changed: [server1]

TASK [Clean up old temp files every 15 minutes] ********************************
changed: [server1]

TASK [carol may not use cron] **************************************************
changed: [server1]

TASK [Backup service] **********************************************************
changed: [server1]

TASK [Backup timer] ************************************************************
changed: [server1]

TASK [The unit files are valid] ************************************************
ok: [server1]

TASK [Backup timer is enabled and running] *************************************
changed: [server1]

PLAY RECAP *********************************************************************
server1  : ok=11   changed=9    unreachable=0    failed=0    skipped=0 ...
```

The second run:

```
PLAY RECAP *********************************************************************
server1  : ok=11   changed=0    unreachable=0    failed=0    skipped=0 ...
server2  : ok=11   changed=0    unreachable=0    failed=0    skipped=0 ...
```

What ended up on the server:

```bash
ansible server2 -b -a "crontab -l -u alice"
ansible server2 -a "cat /etc/cron.d/tmp-cleanup"
```

```
#Ansible: daily disk report
30 2 * * * df -h > /home/alice/disk-report.txt
```

```
MAILTO="root"
#Ansible: clean old tmp files
*/15 * * * * root find /var/tmp -name "*.tmp" -mmin +60 -delete
```

And `carol`:

```
You (carol) are not allowed to use this program (crontab)
See crontab(1) for more information
```

**`--check` on a fresh server** failed at `crond and atd are running` with `Could not find the requested service crond`. In check mode the packages aren't really installed, so the services don't exist yet. After the first real run, `--check` works normally.

## 4. The timer that kept its old time

To see what `daemon_reload: true` on the last task is for, I first moved the backup to 03:00 with it in place, which worked. Then I removed it, moved the backup to 04:00 and ran the playbook again:

```
PLAY RECAP *********************************************************************
server2  : ok=10   changed=1    unreachable=0    failed=0    skipped=0 ...
```

The file on disk said 04:00. systemd didn't agree:

```
NEXT                        LEFT LAST PASSED UNIT             ACTIVATES
Fri 2026-11-20 03:00:00 UTC   8h -         - backup-etc.timer backup-etc.service
```

```
Warning: The unit file, source configuration file or drop-ins of backup-etc.timer changed on disk. Run 'systemctl daemon-reload' to reload units.
```

systemd keeps unit files in memory and only reads them again on `daemon-reload`. Ansible copied the file, saw that the timer was already running, and had nothing else to do. With `daemon_reload: true` on the last task, the new time took effect on the same run.

## 5. The cron job that was there twice

I renamed the job in the playbook from `daily disk report` to `alice disk report`, without changing anything else:

```
#Ansible: daily disk report
30 2 * * * df -h > /home/alice/disk-report.txt
#Ansible: alice disk report
30 2 * * * df -h > /home/alice/disk-report.txt
```

The module finds its jobs **by name**. It didn't find `alice disk report`, so it added it, and it didn't touch `daily disk report`, because nothing in the playbook mentions it any more. `alice` now gets two reports every night.

To rename, remove the old one explicitly in the same run:

```yaml
    - name: Old entry is gone
      ansible.builtin.cron:
        name: daily disk report
        user: alice
        state: absent
```

The same applies to deleting a job: removing the task from the playbook doesn't remove the job from the server. Only `state: absent` does.

## 6. A percent sign that broke the backup at 01:00

The `ExecStart` line uses `%%F`, not `%F`. In a shell, `date +%F` is correct. In a systemd unit, `%` starts a **specifier** (`%n` is the unit name, `%h` the home directory), so I tried a single `%` once:

```
PLAY RECAP *********************************************************************
server2  : ok=10   changed=2    unreachable=0    failed=0    skipped=0 ...
```

Ansible reported success. The error only appeared when the service started:

```
Failed to start backup-etc.service: Unit backup-etc.service has a bad unit file setting.
```

```
/etc/systemd/system/backup-etc.service:6: Failed to resolve unit specifiers in 'mkdir -p /var/backups && tar -czf /var/backups/etc-$(date +%F).tar.gz /etc': Invalid slot
```

On a real server that's 01:00, with nobody watching, and you notice the missing backups days later. `%%` is a literal `%`.

That's what the `systemd-analyze verify` task is for. It checks both unit files **before** the timer is enabled. With the single `%`, the play stopped there:

```
fatal: [server2]: FAILED! => {"changed": false, "cmd": ["systemd-analyze", "verify", "/etc/systemd/system/backup-etc.service", "/etc/systemd/system/backup-etc.timer"], ... "rc": 1, ...
```

`changed_when: false` because checking changes nothing. In `--check` mode the task is skipped: the files it would check haven't been written.

## 7. One-off jobs with at

`at` runs a command once, at a set time. That's the opposite of what a playbook describes: a state that should stay true. A job in the `at` queue runs and disappears, so there's no state for the next run to compare against. I ran the same command twice:

```bash
ansible server2 -b -m shell -a 'echo "systemctl restart httpd" | at 23:00'
ansible server2 -b -m shell -a 'echo "systemctl restart httpd" | at 23:00'
ansible server2 -b -a atq
```

```
1	Thu Nov 19 23:00:00 2026 a root
2	Thu Nov 19 23:00:00 2026 a root
```

Two jobs, and httpd restarts twice at 23:00. So `at` is an **ad-hoc** job: run it once from the command line, as above, and check `atq` afterwards. It needs the `shell` module because of the pipe ([lab 1](/labs/ansible-control-node-and-admin-access/) showed what `command` does with one). The playbook only makes sure `atd` is installed and running.

To remove a job: `ansible server2 -b -a "atrm 2"`.

## Verification

From `~/ansible` on `server1`:

```bash
ansible all -b -a "crontab -l -u alice"              # #Ansible: daily disk report, once
ansible all -a "cat /etc/cron.d/tmp-cleanup"         # MAILTO="root" + the find job
ansible all -b -a "cat /etc/cron.deny"               # carol (mode 600, needs root)
ansible all -a "systemctl list-timers backup-etc.timer"   # next run at 01:00
ansible all -b -a "systemctl start backup-etc.service"     # run the backup now
ansible all -a "ls /var/backups"                     # etc-<date>.tar.gz
ansible-playbook schedule.yml                        # changed=0 on both
```

As `carol` on one of the servers, `crontab -e` should be refused.

## Safety notes

- **Never rename a cron task without a `state: absent` for the old name.** Otherwise the job runs twice.
- **Removing a task from the playbook doesn't remove the job.** Use `state: absent`, run the playbook, and then you can delete the task.
- **Write `%%` in systemd unit files** where you mean `%`, and keep the `systemd-analyze verify` task.
- **Use `daemon_reload: true`** on the task that enables or restarts a unit after its file changed.
- **`/etc/cron.allow` wins over `cron.deny`.** If `cron.allow` exists, only users listed in it can use cron, and `cron.deny` is ignored.
- **Don't put `at` jobs in a playbook.** Every run adds another one.
