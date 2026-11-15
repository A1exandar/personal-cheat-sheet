+++
title = "Ansible on RHEL 10: Offline Repositories for Every Server"
date = 2026-11-15
description = "The second lab in the Ansible series: one playbook mounts the installation ISO on server1, serves it over HTTP and points both servers at it, with BaseOS and AppStream defined once and a group variable deciding whether a server reads them from disk or over the network. Includes facts that went stale after a remount, a check mode that reported nothing to do on an unmounted repo, and the rhel-system-roles firewall role working with no internet."
tags = ["linux", "rhel", "ansible", "automation", "dnf", "repositories", "httpd", "sysadmin"]
+++

**Goal:** on an air-gapped network, `server1` and `server2` both install packages from the RHEL installation ISO. In two earlier labs this was done by hand: [the ISO as a local repository](/labs/local-repository-from-iso/) and [the same repository served over HTTP](/labs/local-repository-over-http/). Here, one playbook does all of it, and running it again changes nothing.

**Starting point:** the setup from [the first lab in this series](/labs/ansible-control-node-and-admin-access/): `server1` is the control node, the `ansible` user has key-based SSH and sudo on both servers, and the project lives in `~/ansible`. One thing Ansible can't do for you: copy the ISO. It's 10G+, so put it on `server1` as `/rhel10.iso` once, the same way as in the ISO lab.

**Lab environment:**

| Host | IP address | Role |
|---|---|---|
| `server1` | `192.168.10.10` | control node, repository server |
| `server2` | `192.168.10.11` | repository client |

The addresses are examples. Replace them with your own.

**Tested on:** two CentOS Stream 10 containers with systemd (`ansible-core 2.16`, `rhel-system-roles 2.4`), with every online repository removed. The ISO was a test image I built with BaseOS and AppStream from CentOS packages, so the test used the CentOS GPG key. On RHEL, use the Red Hat key, as shown below. Containers don't run SELinux, so I checked the `context=` mount option separately on a VM with SELinux enforcing.

## 1. The plan

| | `server1` | `server2` |
|---|---|---|
| ISO mounted on `/repo` | yes | no |
| Reads BaseOS and AppStream from | `file:///repo` | `http://192.168.10.10/repo` |
| httpd + firewall | yes | no |

Why doesn't `server1` read its own repository over HTTP, like everyone else? It needs a repository to **install** httpd in the first place, so `file://` has to work before HTTP exists. It also keeps `server1` working when httpd is down. I stopped httpd during the test: `server2` failed with `Could not connect to server`, while `server1` still installed packages.

The repository definition is the same on both servers. Only the address differs, so it becomes a **variable** with a different value for each group.

## 2. Inventory with groups

Replace the inventory from the first lab:

```bash
cd ~/ansible
vim inventory
```

```ini
[repo_server]
server1

[repo_clients]
server2

[servers:children]
repo_server
repo_clients
```

`[servers:children]` makes `servers` a group of groups. Everything that targeted `servers` in the first lab still reaches both hosts:

```bash
ansible-inventory --graph
```

```
@all:
  |--@ungrouped:
  |--@servers:
  |  |--@repo_server:
  |  |  |--server1
  |  |--@repo_clients:
  |  |  |--server2
```

## 3. Group variables

Ansible automatically loads `group_vars/<group name>.yml` for every host in that group. No `include` is needed, only the right directory and file name:

```bash
mkdir group_vars
vim group_vars/servers.yml
```

```yaml
---
repo_gpgkey: file:///etc/pki/rpm-gpg/RPM-GPG-KEY-redhat-release
```

```bash
vim group_vars/repo_server.yml
```

```yaml
---
repo_baseurl: file:///repo
```

```bash
vim group_vars/repo_clients.yml
```

```yaml
---
repo_baseurl: http://192.168.10.10/repo
```

Check which value each host gets before you use it:

```bash
ansible all -m debug -a "var=repo_baseurl"
```

```
server1 | SUCCESS => {
    "repo_baseurl": "file:///repo"
}
server2 | SUCCESS => {
    "repo_baseurl": "http://192.168.10.10/repo"
}
```

## 4. The firewall role

`ansible-core` has no firewall module. `ansible.posix.firewalld` is in a separate collection, and `ansible-galaxy` can't download it on an air-gapped network. RHEL has the answer on the same ISO: **RHEL System Roles**, ready-made, Red Hat-supported roles for the firewall, SELinux, time sync, storage and more:

```bash
sudo dnf install rhel-system-roles
```

They're installed under `/usr/share/ansible/collections`, and Ansible finds them there without any configuration. This lab uses only the firewall role. Later labs use more.

## 5. The playbook

```bash
vim repos.yml
```

The playbook has three plays, in this order: mount the ISO on the server, define the repositories everywhere, then install and open httpd. The order matters: httpd comes from the repository that the second play creates.

```yaml
---
- name: Mount the installation ISO on the repo server
  hosts: repo_server
  become: true
  tasks:
    - name: Look for the ISO file
      ansible.builtin.stat:
        path: /rhel10.iso
      register: iso

    - name: Stop if the ISO is missing
      ansible.builtin.assert:
        that: iso.stat.exists
        fail_msg: "/rhel10.iso is missing. Copy the installation ISO to server1 first."

    - name: Mount point
      ansible.builtin.file:
        path: /repo
        state: directory
        mode: "0755"

    - name: Persistent mount in /etc/fstab
      ansible.builtin.lineinfile:
        path: /etc/fstab
        regexp: '^/rhel10\.iso\s'
        line: '/rhel10.iso  /repo  iso9660  defaults,context="system_u:object_r:httpd_sys_content_t:s0"  0 0'
        backup: true
      register: fstab_entry

    - name: Check whether /repo is mounted
      ansible.builtin.command: findmnt /repo
      register: repo_mount
      changed_when: false
      failed_when: false
      check_mode: false

    - name: Mount /repo (again, if the fstab line changed)
      ansible.builtin.shell: |
        systemctl daemon-reload
        umount /repo 2>/dev/null || true
        mount /repo
      when: fstab_entry.changed or repo_mount.rc != 0

- name: BaseOS and AppStream on every server
  hosts: servers
  become: true
  tasks:
    - name: BaseOS repository
      ansible.builtin.yum_repository:
        name: local-BaseOS
        description: RHEL 10 BaseOS (installation ISO)
        file: local-iso
        baseurl: "{{ repo_baseurl }}/BaseOS"
        gpgcheck: true
        gpgkey: "{{ repo_gpgkey }}"

    - name: AppStream repository
      ansible.builtin.yum_repository:
        name: local-AppStream
        description: RHEL 10 AppStream (installation ISO)
        file: local-iso
        baseurl: "{{ repo_baseurl }}/AppStream"
        gpgcheck: true
        gpgkey: "{{ repo_gpgkey }}"

- name: Serve /repo over HTTP
  hosts: repo_server
  become: true
  tasks:
    - name: httpd installed
      ansible.builtin.dnf:
        name: httpd
        state: present

    - name: httpd config for /repo
      ansible.builtin.copy:
        dest: /etc/httpd/conf.d/repo.conf
        content: |
          Alias /repo /repo
          <Directory /repo>
              Options Indexes FollowSymLinks
              Require ip 192.168.10.0/24 127.0.0.1
          </Directory>
        mode: "0644"
      notify: Restart httpd

    - name: httpd running and enabled
      ansible.builtin.systemd_service:
        name: httpd
        state: started
        enabled: true

    - name: Open http in the firewall
      ansible.builtin.include_role:
        name: redhat.rhel_system_roles.firewall
      vars:
        firewall:
          - service: http
            state: enabled

  handlers:
    - name: Restart httpd
      ansible.builtin.systemd_service:
        name: httpd
        state: restarted
```

What each part does:

- **`stat` + `assert`** - if the ISO is missing, the playbook stops with a clear message instead of a confusing `mount` error. When every host in a play fails, Ansible stops the whole playbook. That's useful here: `server2` never gets pointed at a repository server that has nothing to serve.
- **`lineinfile` with `regexp`** - if a line starting with `/rhel10.iso` exists, Ansible replaces it. Otherwise, it adds one. If you followed the earlier ISO lab, your fstab already has the old line without `context=`, and this upgrades it. `backup: true` leaves a dated copy of the old fstab next to it.
- **`context=`** - the SELinux label for the whole ISO, so httpd may read it. The [HTTP repository lab](/labs/local-repository-over-http/) explains why `restorecon` can't do this on a read-only ISO. On the test VM, the same mount showed `httpd_sys_content_t` on `/repo` with the option, and `iso9660_t` without it.
- **`findmnt` + `when`** - mount only when needed. Section 6 shows why this isn't just a check on `ansible_facts`.
- **`yum_repository`** - writes `.repo` files key by key. Watch the names: **`name` is the repository ID** (what `dnf repolist` shows in the first column), and **`description`** becomes the `name=` line in the file. `file: local-iso` puts both repositories in one file, `/etc/yum.repos.d/local-iso.repo`.
- **`notify` + `handlers`** - httpd restarts only when `repo.conf` actually changed, and only once at the end of the play, no matter how many tasks notified it.
- **`include_role`** - runs the firewall role with the list of services to open. The role installs firewalld if it's missing (from the local repository, which by then already exists), starts it, and opens `http` both in the runtime and in the permanent configuration.

## 6. The mistake I made first: stale facts

My first version had a simpler check: mount `/repo` when it isn't in `ansible_facts.mounts`:

```yaml
    - name: Mount it if it is not mounted
      ansible.builtin.command: mount /repo
      when: ansible_facts.mounts | selectattr("mount", "equalto", "/repo") | list | length == 0
```

On a fresh server, the task before it had just mounted `/repo`, and this one still tried to mount it again:

```
TASK [Mount it if it is not mounted] *******************************************
fatal: [server1]: FAILED! => {..., "stderr": "mount: /repo: /rhel10.iso is already mounted."}
```

**Facts are a snapshot taken by `Gathering Facts` at the start of a play.** Nothing updates them when a task changes the server. As far as `ansible_facts.mounts` knew, `/repo` still wasn't mounted. The fix is to ask the server right before the decision, as the final playbook does with `findmnt`.

`findmnt` only reads, so it's marked with:

- `changed_when: false` - a check is never a change.
- `failed_when: false` - exit code 1 (not mounted) is a valid answer, not an error.
- `check_mode: false` - run it even in `--check` mode. Without this, `--check` skipped the check, then skipped the mount, and reported **nothing to do** on a server where `/repo` wasn't mounted at all. With it, `--check -v` says what it would do:

```
TASK [Mount /repo (again, if the fstab line changed)] **************************
skipping: [server1] => {..., "msg": "Command would have run if not in check mode", ...}
```

## 7. Run it

```bash
ansible-playbook --syntax-check repos.yml
ansible-playbook repos.yml
```

The first run on a fresh setup, shortened (the firewall role prints about 30 tasks of its own):

```
TASK [Persistent mount in /etc/fstab] ******************************************
changed: [server1]

TASK [Check whether /repo is mounted] ******************************************
ok: [server1]

TASK [Mount /repo (again, if the fstab line changed)] **************************
changed: [server1]

PLAY [BaseOS and AppStream on every server] ************************************

TASK [BaseOS repository] *******************************************************
changed: [server2]
changed: [server1]

TASK [AppStream repository] ****************************************************
changed: [server2]
changed: [server1]

PLAY [Serve /repo over HTTP] ***************************************************

TASK [httpd installed] *********************************************************
changed: [server1]
...
TASK [redhat.rhel_system_roles.firewall : Install firewalld] *******************
changed: [server1]
...
TASK [redhat.rhel_system_roles.firewall : Configure firewall] ******************
changed: [server1]
...
RUNNING HANDLER [Restart httpd] ************************************************
changed: [server1]

PLAY RECAP *********************************************************************
server1  : ok=31   changed=10   unreachable=0    failed=0    skipped=12 ...
server2  : ok=3    changed=2    unreachable=0    failed=0    skipped=0  ...
```

The second run:

```
PLAY RECAP *********************************************************************
server1  : ok=29   changed=0    unreachable=0    failed=0    skipped=13 ...
server2  : ok=3    changed=0    unreachable=0    failed=0    skipped=0  ...
```

`changed=0` on both servers: everything is already as described.

**Old repository files from the manual labs:** if you followed the earlier labs by hand, `/etc/yum.repos.d/` may also contain `repo_BaseOS.repo`, `repo_AppStream.repo` or `local-http.repo`. They have different IDs, so `dnf` treats them as separate repositories and loads the same packages twice. Remove them once the playbook has run:

```bash
ansible all -a "ls /etc/yum.repos.d/"
```

## Verification

From `~/ansible` on `server1`:

```bash
ansible all -a "dnf repolist"                       # local-BaseOS and local-AppStream on both
ansible server1 -a "findmnt -n /repo"               # /rhel10.iso on /repo, iso9660, ro
ansible server1 -b -a "firewall-cmd --list-services"   # http in the list
ansible server2 -a "curl -sI http://192.168.10.10/repo/BaseOS/repodata/repomd.xml"   # HTTP/1.1 200 OK
ansible server2 -b -a "dnf --refresh -y install nmap"   # downloaded from server1, GPG-checked
ansible-playbook repos.yml                          # changed=0 on both
```

```
server2 | CHANGED | rc=0 >>
repo id                       repo name
local-AppStream               RHEL 10 AppStream (installation ISO)
local-BaseOS                  RHEL 10 BaseOS (installation ISO)
server1 | CHANGED | rc=0 >>
repo id                       repo name
local-AppStream               RHEL 10 AppStream (installation ISO)
local-BaseOS                  RHEL 10 BaseOS (installation ISO)
```

On `server1`, check the SELinux label of `/repo` too. In my containers SELinux was off, but on a real RHEL server it's on:

```bash
ansible server1 -a "ls -Zd /repo"      # system_u:object_r:httpd_sys_content_t:s0
```

## Safety notes

- **`lineinfile` on `/etc/fstab` can make a server unbootable** if the line is wrong. `backup: true` keeps the previous version, and the remount task tests the new line right away instead of at the next boot. The playbook fails there if `mount` fails, and you can fix it before a reboot finds it.
- **Leave `gpgcheck: true` on.** Plain HTTP between the servers has no integrity protection. The GPG signature on every package is what proves it came from Red Hat.
- **`Require ip`** limits access to the lab network. If your network is different, change the subnet in `repo.conf`, or `server2` gets `403 Forbidden`.
- **Don't delete `/rhel10.iso`** while it's in fstab. `server1` would drop into emergency mode on the next boot, and `server2` would lose its repositories at the same time.
- **Run with `--check --diff` before every real run**, especially on fstab and repository files. Section 6 shows why `check_mode: false` belongs on read-only checks.
