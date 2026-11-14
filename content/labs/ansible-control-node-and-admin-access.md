+++
title = "Ansible on RHEL 10: Control Node and a Dedicated ansible User"
date = 2026-11-14
description = "The first lab in a series that automates RHCSA tasks with Ansible: server1 becomes the control node for itself and server2, a dedicated ansible user gets an SSH key and passwordless sudo, and a project directory gets its own ansible.cfg and inventory. Includes an ansible.cfg that was silently ignored, a pipe the command module didn't understand, and a broken sudo rule that Ansible couldn't fix without a password."
tags = ["linux", "rhel", "ansible", "automation", "ssh", "sudo", "sysadmin"]
+++

**Goal:** prepare two RHEL 10 servers for Ansible. `server1` becomes the **control node**, the machine where Ansible is installed and from which it runs. `server2` and `server1` itself are **managed nodes**. At the end, one command from `server1` reaches both servers with root rights, with no password prompts.

**About this series:** this is the first of several labs that automate the tasks from my RHCSA practice exercises (repositories, LVM, users, scheduling, containers, SELinux and so on) on the same two servers. Every later lab builds on the user, key and project directory set up here.

**Lab environment:**

| Host | IP address | Role |
|---|---|---|
| `server1` | `192.168.10.10` | control node + managed node |
| `server2` | `192.168.10.11` | managed node |

The addresses are examples. Replace them with your own.

**Tested on:** two CentOS Stream 10 containers with systemd and sshd. CentOS Stream 10 is the upstream of RHEL 10 and its AppStream ships the same `ansible-core` package. The test gave me `ansible-core 2.16`. Every command and output below comes from that run.

## 1. Why a dedicated user

Ansible connects to each managed node over SSH as a normal user, then uses `sudo` to become root for tasks that need it. You could connect as root, but RHEL 10 blocks root password logins over SSH by default (`PermitRootLogin prohibit-password`). Also, root's actions in the logs would all look the same.

A dedicated `ansible` user makes it clear in `/var/log/secure` and the journal which changes came from automation. It also needs the same three things on every server:

1. The same username on every managed node.
2. The control node's public SSH key in its `~/.ssh/authorized_keys`.
3. A sudo rule that doesn't ask for a password, because Ansible runs unattended.

## 2. Create the ansible user on both servers

This is the one step that can't be automated yet, because Ansible has no access before it exists. Do it as root on **both** servers, from the console or over SSH with your normal admin account:

```bash
useradd ansible
passwd ansible
```

The password is needed only once, in step 4, for `ssh-copy-id`. Later it's also your emergency key (section 9).

Now the sudo rule. Put it in its own file under `/etc/sudoers.d/` instead of editing `/etc/sudoers`. Then a mistake stays in a small file that's easy to fix or remove:

```bash
echo "ansible ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/ansible
chmod 440 /etc/sudoers.d/ansible
visudo -cf /etc/sudoers.d/ansible
```

```
/etc/sudoers.d/ansible: parsed OK
```

**Always run `visudo -cf` after writing a sudoers file by hand.** A syntax error in any file under `/etc/sudoers.d/` breaks `sudo` for **every** user on the server, not just `ansible`.

## 3. Name resolution on the control node

Only the control node needs to resolve the names of the managed nodes. Without DNS, add them to `/etc/hosts` on `server1`:

```bash
cat >> /etc/hosts <<EOF
192.168.10.10 server1
192.168.10.11 server2
EOF
```

## 4. SSH key for the ansible user

From here on, everything on `server1` runs as `ansible`, not as root. The key has to belong to the user that runs Ansible:

```bash
su - ansible
ssh-keygen -t ed25519
```

Press Enter at all three prompts: the default path and an empty passphrase. A passphrase would make Ansible ask for it on every run, unless you set up `ssh-agent`.

Copy the public key to **both** servers, including `server1` itself. Ansible connects to `server1` over SSH too, like to any other managed node:

```bash
ssh-copy-id ansible@server1
ssh-copy-id ansible@server2
```

The first connection asks you to confirm the host key (`yes`), then asks for the `ansible` user's password from step 2.

Check that it works without any password, including sudo:

```bash
for h in server1 server2; do ssh $h "hostname; sudo -n id -un"; done
```

```
server1
root
server2
root
```

`sudo -n` means non-interactive: if sudo wanted a password, it would fail instead of asking. That's exactly how Ansible will use it.

## 5. Install Ansible on the control node

`ansible-core` is in the AppStream repository, so `server1` needs a working AppStream: a RHEL subscription, or the [local repository from the installation ISO](/labs/local-repository-from-iso/).

```bash
sudo dnf install ansible-core
ansible --version
```

```
ansible [core 2.16.20]
  config file = /etc/ansible/ansible.cfg
  ...
```

Only the control node needs Ansible. The managed nodes need just SSH and Python, and RHEL 10 has both.

**`ansible-core` is the bare minimum.** It has about 70 modules from `ansible.builtin`: `copy`, `user`, `dnf`, `service`, `lineinfile` and so on. Many modules from tutorials aren't in it. For example, `ansible.posix.authorized_key` gives:

```
[WARNING]: ansible.posix.authorized_key was not found
```

Those come in separate collections. A later lab installs what it needs. For now, `ansible.builtin` is enough.

## 6. Project directory, ansible.cfg and inventory

The line `config file = /etc/ansible/ansible.cfg` above shows that Ansible is using the system-wide config. Each project should have its own instead. Ansible looks for `ansible.cfg` in the **current directory** first, so create the project directory and work from it:

```bash
mkdir ~/ansible && cd ~/ansible
vim ansible.cfg
```

```ini
[defaults]
inventory = ./inventory
remote_user = ansible

[privilege_escalation]
become = false
become_method = sudo
```

- `inventory` - the file with the list of servers, so you don't have to pass `-i` to every command.
- `remote_user` - the user Ansible logs in as on the managed nodes.
- `become = false` - Ansible doesn't become root by default. You ask for it per command (`--become`) or per playbook (`become: true`), so it's always visible when something runs as root.

```bash
vim inventory
```

```ini
[servers]
server1
server2
```

`[servers]` is a **group**. Commands can target a group, a single host or `all`. Later labs add more groups when some tasks belong to only one server.

Check that Ansible now uses this config and reads the inventory correctly:

```bash
ansible --version | grep "config file"
ansible-inventory --graph
```

```
  config file = /home/ansible/ansible/ansible.cfg
@all:
  |--@ungrouped:
  |--@servers:
  |  |--server1
  |  |--server2
```

**A directory where anyone can write is ignored.** I copied the same two files into a world-writable directory (`chmod 777`), and Ansible refused the `ansible.cfg` with a warning and went back to `/etc/ansible/ansible.cfg`:

```
[WARNING]: Ansible is being run in a world writable directory (/tmp/proj),
ignoring it as an ansible.cfg source.
```

This is deliberate: otherwise anyone could plant an `ansible.cfg` there. Keep projects in your home directory, and if Ansible ever stops seeing your inventory, check `ansible --version` first.

## 7. First commands: ad-hoc

An ad-hoc command runs one module on many servers at once, without a playbook:

```bash
ansible all -m ping
```

```
server1 | SUCCESS => {
    "ansible_facts": {
        "discovered_interpreter_python": "/usr/bin/python3"
    },
    "changed": false,
    "ping": "pong"
}
server2 | SUCCESS => {
    ...
    "ping": "pong"
}
```

**The `ping` module is not ICMP ping.** It logs in over SSH, runs a small Python program and returns `pong`. A `pong` proves the whole chain: name resolution, SSH, the key, the user and Python on the managed node.

Without `--become`, commands run as `ansible`. With it, as root:

```bash
ansible all -a "id -un"
ansible all -a "id -un" --become
```

```
server2 | CHANGED | rc=0 >>
ansible
server1 | CHANGED | rc=0 >>
ansible

server2 | CHANGED | rc=0 >>
root
server1 | CHANGED | rc=0 >>
root
```

`-a` without `-m` uses the `command` module. Ansible reports it as `CHANGED` because it can't know what an arbitrary command did.

**`command` doesn't understand pipes.** It runs a program directly, without a shell, so `|` is passed to `cat` as a normal argument:

```bash
ansible server2 -a "cat /etc/passwd | wc -l"
```

```
server2 | FAILED | rc=1 >>
cat: invalid option -- 'l'
```

For pipes, redirects and variables like `$HOME`, use the `shell` module:

```bash
ansible server2 -m shell -a "cat /etc/passwd | wc -l"
```

```
server2 | CHANGED | rc=0 >>
18
```

Prefer `command` when you don't need a shell. It's safer, because nothing in the arguments gets interpreted.

## 8. First playbook: Ansible maintains its own access

Ad-hoc commands are for quick checks. Changes that should stay the same go into a **playbook**, which describes the state you want, not the steps to get there. The first one takes care of the sudo rule from step 2, so a server where someone changes it gets fixed on the next run:

```bash
vim admin-access.yml
```

```yaml
---
- name: Keep the ansible user's sudo access in place
  hosts: all
  become: true
  tasks:
    - name: Sudo rule for the ansible user
      ansible.builtin.copy:
        dest: /etc/sudoers.d/ansible
        content: "ansible ALL=(ALL) NOPASSWD: ALL\n"
        owner: root
        group: root
        mode: "0440"
        validate: /usr/sbin/visudo -cf %s
```

`validate` is the playbook version of the `visudo -cf` from step 2. Ansible writes the new content to a temporary file, runs `visudo` on it, and replaces the real file only if the check passes.

```bash
ansible-playbook --syntax-check admin-access.yml
ansible-playbook admin-access.yml
```

```
TASK [Sudo rule for the ansible user] ******************************************
ok: [server2]
ok: [server1]

PLAY RECAP *********************************************************************
server1  : ok=2    changed=0    unreachable=0    failed=0  ...
server2  : ok=2    changed=0    unreachable=0    failed=0  ...
```

`ok` and `changed=0`: the file already looks exactly as described, so Ansible didn't touch it. That's **idempotence**: you can run the same playbook ten times, and it only changes what differs from the description.

### When validate saves you

I removed the colon after `NOPASSWD` in the playbook, the kind of typo that would break sudo on every server:

```
TASK [Sudo rule for the ansible user] ******************************************
fatal: [server1]: FAILED! => {"changed": false, ..., "msg": "failed to validate",
"stderr": "...source:1:28: syntax error\nansible ALL=(ALL) NOPASSWD ALL\n ..."}
```

The task failed, and `/etc/sudoers.d/ansible` stayed the old, working version. Without `validate`, Ansible would have written the broken file to both servers and then lost root access to both of them.

## 9. When the sudo rule breaks

Now the case the playbook should fix: someone on `server2` changed the rule to require a password:

```bash
echo "ansible ALL=(ALL) ALL" > /etc/sudoers.d/ansible     # as root on server2
```

Running the playbook again **doesn't** fix it:

```
TASK [Gathering Facts] *********************************************************
fatal: [server2]: FAILED! => {"msg": "Missing sudo password"}
ok: [server1]
```

Ansible needs sudo to fix the sudo rule, and sudo now wants a password. This is a deadlock, so plan for it before it happens. The way out is `-K` (`--ask-become-pass`). Ansible asks for the `ansible` user's password once and passes it to sudo:

```bash
ansible-playbook admin-access.yml --limit server2 -K --diff
```

```
BECOME password:
...
TASK [Sudo rule for the ansible user] ******************************************
--- before: /etc/sudoers.d/ansible
+++ after: /etc/sudoers.d/ansible
@@ -1 +1 @@
-ansible ALL=(ALL) ALL
+ansible ALL=(ALL) NOPASSWD: ALL

changed: [server2]
```

- `--limit server2` - runs only on the broken server.
- `--diff` - shows exactly what changed in the file.

That's why the `ansible` user still has a password even though Ansible normally logs in with a key. Keep it somewhere safe.

## Verification

From a new session on `server1`, as `ansible`, inside `~/ansible`:

```bash
ansible --version | grep "config file"     # ~/ansible/ansible.cfg, not /etc/ansible
ansible-inventory --graph                  # servers: server1, server2
ansible all -m ping                        # pong from both
ansible all -a "id -un" --become           # root on both, no password prompt
ansible-playbook admin-access.yml          # changed=0 on both
```

The last line is the real test. A second run with `changed=0` means the servers match the playbook exactly.

## Safety notes

- **Never edit sudoers without a check.** `visudo -cf` by hand, `validate:` in Ansible. A single broken file in `/etc/sudoers.d/` breaks sudo for everyone.
- **Keep a root session open while you change sudo or SSH access.** If you lock yourself out, the open session is the quickest way back.
- **`NOPASSWD: ALL` makes the `ansible` user's SSH key equal to root.** Protect the private key on `server1` (`~/.ssh/id_ed25519`, mode `600`), and don't copy it to other machines.
- **Keep the `ansible` user's password.** It's the only way out of the deadlock in section 9.
- **Work from the project directory.** Outside `~/ansible`, Ansible uses `/etc/ansible/ansible.cfg` and a different inventory, and commands can reach the wrong servers or none at all.
