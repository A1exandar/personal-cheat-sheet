+++
title = "Ansible on RHEL 10: Users, Groups and Permissions with Ansible Vault"
date = 2026-11-17
description = "The fourth lab in the Ansible series: one playbook creates a group, three users with passwords kept in an encrypted Ansible Vault file, a 90-day password lifetime and a shared directory with setgid, sticky bit and a default ACL. Includes passwords that changed on every run, a user who silently lost the wheel group, a shared file nobody else could edit, and a check mode that failed on a fresh server."
tags = ["linux", "rhel", "ansible", "automation", "users", "permissions", "acl", "vault", "sysadmin"]
+++

**Goal:** the same users, groups and shared directory on `server1` and `server2`, with passwords that never appear in plain text:

- a group `devops`
- users `alice` and `bob` in `devops`, and `carol`, who can't log in (`/sbin/nologin`)
- passwords stored in a file encrypted with **Ansible Vault**
- passwords expire after 90 days, for these users and for every user created later
- a shared directory `/srv/devops` where the group can read and edit each other's files but can't delete them

These are the user, group and permission tasks from my RHCSA practice exercises. The names here are examples. Use your own.

**Starting point:** the setup from [lab 1](/labs/ansible-control-node-and-admin-access/) and [lab 2](/labs/ansible-offline-repositories/): `server1` is the control node, the project is in `~/ansible`, and both servers install packages from the ISO repositories.

**Lab environment:**

| Host | IP address | Role |
|---|---|---|
| `server1` | `192.168.10.10` | control node + managed node |
| `server2` | `192.168.10.11` | managed node |

The addresses are examples. Replace them with your own.

**Tested on:** two CentOS Stream 10 containers with systemd (`ansible-core 2.16`, Python 3.12). Every output below comes from that test.

## 1. Passwords in a playbook

The `user` module's `password` option doesn't take a password. It takes the **hash**, the string that ends up in `/etc/shadow`. That leaves two problems: where the password comes from, and how it becomes a hash.

Many guides use the `password_hash` filter, so I tried it first:

```yaml
        password: "{{ user_passwords[item.name] | password_hash('sha512') }}"
```

It worked, but with two problems:

```
[DEPRECATION WARNING]: Encryption using the Python crypt module is deprecated.
The Python crypt module is deprecated and will be removed from Python 3.13.
```

```
PLAY RECAP *********************************************************************
server1  : ok=3    changed=1    ...     # second run
server2  : ok=3    changed=1    ...
```

- **The filter depends on a Python module that's going away.** The replacement, `passlib`, isn't in the RHEL 10 repositories.
- **The second run reported `changed`.** Without a fixed salt, `password_hash` makes a new hash every time, so Ansible "changes" every password on every run.

The simpler way: make the hash **once**, yourself, and store the hash. `openssl passwd -6` makes a SHA-512 hash, the same format `/etc/shadow` accepts. Run it once per user. It asks for the password twice and prints the hash:

```bash
openssl passwd -6
```

```
Password:
Verifying - Password:
$6$HGghd6VHl.ZOXR.K$o/9W8...
```

The hash isn't the password, but it can be cracked offline, so it still goes into an encrypted file.

## 2. The vault

Ansible Vault encrypts a whole YAML file with AES256. Ansible decrypts it in memory when it runs and never writes the plain text to disk.

Store the vault password in a file only the `ansible` user can read, so you don't have to type it on every run:

```bash
cd ~/ansible
vim ~/.vault_pass                 # one line: the vault password
chmod 600 ~/.vault_pass
```

Tell Ansible where it is, in the `[defaults]` section of `ansible.cfg`:

```ini
vault_password_file = ~/.vault_pass
```

Create the vault. `ansible-vault create` opens an editor, and the file is encrypted when you save it:

```bash
ansible-vault create vault.yml
```

```yaml
---
user_password_hashes:
  alice: "$6$HGghd6VHl.ZOXR.K$o/9W8..."
  bob: "$6$1BjmELo9H86kZCGk$ST..."
  carol: "$6$7IYznaYMqDyOUHjY$..."
```

Paste the full hashes from section 1. On disk, the file is now unreadable:

```bash
head -3 vault.yml
```

```
$ANSIBLE_VAULT;1.1;AES256
35636537316662353634373566313033373462343966353666623532333235373633383766376130
3164616539333835303866616132613737363730313362640a303539643934323533366138313535
```

The commands you need later:

```bash
ansible-vault view vault.yml       # show it
ansible-vault edit vault.yml       # change it, re-encrypted on save
ansible-vault rekey vault.yml      # change the vault password
```

If you'd rather not keep the password in a file, leave out `vault_password_file` and add `--ask-vault-pass` to every `ansible-playbook` command.

## 3. The user list

The users themselves aren't secret, so they go into `group_vars/servers.yml`, under the variables from the earlier labs:

```bash
vim group_vars/servers.yml
```

```yaml
lab_users:
  - name: alice
    groups: devops
  - name: bob
    groups: devops
  - name: carol
    shell: /sbin/nologin
```

A user who has no `groups` or `shell` here gets the system default for that option.

## 4. The playbook

```bash
vim users.yml
```

```yaml
---
- name: Users, groups and a shared directory
  hosts: servers
  become: true
  vars_files:
    - vault.yml
  tasks:
    - name: Group devops
      ansible.builtin.group:
        name: devops
        state: present

    - name: Users
      ansible.builtin.user:
        name: "{{ item.name }}"
        groups: "{{ item.groups | default(omit) }}"
        append: "{{ item.groups is defined }}"
        shell: "{{ item.shell | default(omit) }}"
        password: "{{ user_password_hashes[item.name] }}"
        password_expire_max: 90
      loop: "{{ lab_users }}"
      loop_control:
        label: "{{ item.name }}"

    - name: New users get a 90-day password lifetime too
      ansible.builtin.lineinfile:
        path: /etc/login.defs
        regexp: "^PASS_MAX_DAYS"
        line: "PASS_MAX_DAYS   90"

    - name: Shared directory for devops
      ansible.builtin.file:
        path: /srv/devops
        state: directory
        owner: root
        group: devops
        mode: "3770"

    - name: ACL tools are installed
      ansible.builtin.dnf:
        name: acl
        state: present

    - name: Read the ACL of /srv/devops
      ansible.builtin.command: getfacl -p /srv/devops
      register: devops_acl
      changed_when: false
      failed_when: false
      check_mode: false

    - name: New files in /srv/devops are writable by the group
      ansible.builtin.command: setfacl -d -m g:devops:rwx /srv/devops
      when: "\"default:group:devops:rwx\" not in devops_acl.stdout"
```

How to read it:

- **`vars_files: vault.yml`** loads the encrypted file. Ansible decrypts it with the password from `~/.vault_pass`.
- **`loop`** runs the `user` task once for each entry in `lab_users`. **`label`** prints only the user's name for each item.
- **`password_expire_max: 90`** is `chage -M 90`, for these users. The `login.defs` line does the same for users created later with `useradd`.
- **Mode `3770`**: `2000` is setgid, so new files belong to the group `devops`. `1000` is the sticky bit, so only a file's owner can delete it. `770` gives the owner and group full access and nobody else any.
- The last three tasks are explained in sections 6 and 7.

The `user` module hides the password even with `-v`. Its output shows `"password": "NOT_LOGGING_PASSWORD"`.

## 5. Run it

```bash
ansible-playbook --syntax-check users.yml
ansible-playbook users.yml --check
ansible-playbook users.yml
```

```
TASK [Group devops] ************************************************************
changed: [server2]
changed: [server1]

TASK [Users] *******************************************************************
changed: [server1] => (item=alice)
changed: [server2] => (item=alice)
changed: [server2] => (item=bob)
changed: [server1] => (item=bob)
changed: [server2] => (item=carol)
changed: [server1] => (item=carol)

TASK [New users get a 90-day password lifetime too] ****************************
changed: [server2]
changed: [server1]

TASK [Shared directory for devops] *********************************************
changed: [server2]
changed: [server1]

TASK [ACL tools are installed] *************************************************
changed: [server2]
changed: [server1]

TASK [Read the ACL of /srv/devops] *********************************************
ok: [server2]
ok: [server1]

TASK [New files in /srv/devops are writable by the group] **********************
changed: [server1]
changed: [server2]

PLAY RECAP *********************************************************************
server1  : ok=8    changed=6    unreachable=0    failed=0    skipped=0 ...
server2  : ok=8    changed=6    unreachable=0    failed=0    skipped=0 ...
```

The second run:

```
PLAY RECAP *********************************************************************
server1  : ok=7    changed=0    unreachable=0    failed=0    skipped=1 ...
server2  : ok=7    changed=0    unreachable=0    failed=0    skipped=1 ...
```

`skipped=1` is the `setfacl` task: the ACL is already there.

Without the vault password, Ansible stops before it touches anything:

```
ERROR! Invalid vars_file '/home/ansible/ansible/vault.yml'.. Attempting to decrypt but no vault secrets found
```

And with a wrong one:

```
ERROR! Invalid vars_file '/home/ansible/ansible/vault.yml'.. Decryption failed (no vault secrets were found that could decrypt) on /home/ansible/ansible/vault.yml
```

## 6. The mistakes I made first

**`bob` lost the `wheel` group.** In the test, `bob` already existed on `server2` and was in `wheel`, added by hand earlier. After my first version of the playbook:

```
uid=1001(bob) gid=1001(bob) groups=1001(bob),10(wheel)                  # before
uid=1001(bob) gid=1001(bob) groups=1001(bob),1002(devops)               # after
```

`groups` without `append` means "exactly these groups", so the module removed every other secondary group without a warning. With `append: true` it only adds. A user like `carol`, who has no `groups` in the list, then got a warning:

```
[WARNING]: 'append' is set, but no 'groups' are specified.
```

So the playbook sets `append` only for users that have `groups`: `append: "{{ item.groups is defined }}"`. The flip side: with `append`, removing a group from the list doesn't remove the user from it. Use `usermod -rG` by hand, or `append: false` for that one run.

**Nobody could edit a shared file.** After the first run, `alice` created a file in `/srv/devops`, and `bob` tried to add a line:

```
-rw-r--r--. 1 alice devops 0 Nov 17 19:55 plan.txt
bash: line 1: /srv/devops/plan.txt: Permission denied
```

Setgid gave the file the right **group**, but the group couldn't **write** to it. `alice`'s umask (`022`) created it as `rw-r--r--`. The fix is a **default ACL** on the directory. Every new file inside it inherits group write access, no matter what the umask is:

```
default:user::rwx
default:group::rwx
default:group:devops:rwx
default:mask::rwx
default:other::---
```

```
-rw-rw----+ 1 alice devops 0 Nov 17 19:56 plan.txt
bob-write-ok
rm: cannot remove '/srv/devops/plan.txt': Operation not permitted
```

`bob` can now edit the file, but the sticky bit still stops him from deleting it. The `+` after the permissions means the file has an ACL.

## 7. Why the ACL is done with command

The Ansible module for ACLs, `acl`, is in the `ansible.posix` collection, which isn't part of `ansible-core` and can't be downloaded offline. So the playbook runs the commands itself, and has to do two things the module would have done for it:

- **Check first, then change.** `getfacl` reads the ACL with `changed_when: false`, since reading changes nothing. `setfacl` runs only when the `devops` entry is missing. Without the check, `setfacl` would report `changed` on every run.
- **Install the tools.** My test servers didn't have the `acl` package, and the first run failed with `getfacl: command not found`.

**Check mode on a fresh server.** In `--check` mode, nothing is created, not even the directory or the `acl` package. The `getfacl` task still runs (`check_mode: false`, so later tasks get a real answer), and on a fresh server it failed:

```
fatal: [server1]: FAILED! => {... "cmd": "getfacl -p /srv/devops", "msg": "[Errno 2] No such file or directory: b'getfacl'" ...}
```

`failed_when: false` turns that into an empty answer. `setfacl` then shows up as "would run", and `--check` completes.

One case `--check` still can't handle: a user who **already exists** and gets a group that the same run would create. In check mode the group isn't really created, so the `user` task fails with `Group devops does not exist`. That's a limit of check mode, not of the playbook. The real run creates the group first and works.

## 8. Changing a password

Make a new hash, then put it in the vault:

```bash
openssl passwd -6
ansible-vault edit vault.yml       # replace bob's hash
ansible-playbook users.yml
```

Only the changed user is reported:

```
TASK [Users] *******************************************************************
changed: [server2] => (item=bob)
changed: [server1] => (item=bob)
```

## Verification

From `~/ansible` on `server1`:

```bash
ansible all -a "id alice"                          # groups include devops
ansible all -a "id bob"
ansible all -b -a "chage -l alice"                 # Maximum ... : 90
ansible all -a "grep ^PASS_MAX_DAYS /etc/login.defs"
ansible all -a "ls -ld /srv/devops"                # drwxrws--T+ root devops
ansible all -a "getfacl -p /srv/devops"            # default:group:devops:rwx
ansible-playbook users.yml                         # changed=0 on both
```

On one of the servers, test what the users can actually do:

```bash
sudo su - carol                                    # This account is currently not available.
sudo -u alice touch /srv/devops/plan.txt
sudo -u bob sh -c 'echo edit >> /srv/devops/plan.txt'   # works
sudo -u bob rm /srv/devops/plan.txt                # Operation not permitted
```

Then log in as `alice` over SSH with the password you hashed in section 1.

## Safety notes

- **Never put plain-text passwords in a playbook, inventory or `group_vars`.** Even a hash goes into the vault.
- **`~/.vault_pass` must be mode `600`.** Anyone who can read it can decrypt the vault. If the project ever goes into git, the vault file can go in, but `.vault_pass` must never be committed.
- **Think about `append` before you run a `user` task with `groups`.** Without it, every secondary group not in your list, including `wheel`, is removed without a warning.
- **A second run must say `changed=0`.** If a password task reports `changed` every time, the hash is being regenerated, as in section 1.
- **Don't edit `/etc/login.defs` by hand on these servers any more.** The playbook puts its line back on the next run.
