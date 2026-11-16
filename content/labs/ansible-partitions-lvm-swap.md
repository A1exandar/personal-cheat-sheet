+++
title = "Ansible on RHEL 10: Partitions, LVM and Swap with the Storage Role"
date = 2026-11-17
description = "The third lab in the Ansible series: one playbook gives server1 and server2 an XFS partition on /backup, a volume group with a logical volume on /data and swap on LVM, all mounted by UUID in /etc/fstab. Growing the volume is a one-line change. Includes a partition name that made a new partition on every run, a swap resize the role skipped without a word, and safe mode refusing to format a disk that still had data on it."
tags = ["linux", "rhel", "ansible", "automation", "lvm", "storage", "swap", "sysadmin"]
+++

**Goal:** both servers get the same disk layout, described once in a playbook instead of typed out with `parted`, `pvcreate`, `mkfs` and `vim /etc/fstab` on each of them:

- a 500M XFS **partition** on the first extra disk, mounted on `/backup`
- a **volume group** `vg_data` on the second extra disk, with an XFS logical volume `lv_data` on `/data` and a **swap** volume `lv_swap`
- everything mounted by UUID in `/etc/fstab`, so it survives a reboot

These are the partition and LVM tasks from my RHCSA practice exercises. The manual versions are in [LVM from scratch](/labs/lvm-from-scratch/) and [persistent swap on LVM](/labs/persistent-swap-on-lvm/).

**Starting point:** the setup from [lab 1](/labs/ansible-control-node-and-admin-access/) and [lab 2](/labs/ansible-offline-repositories/): `server1` is the control node, the project is in `~/ansible`, and both servers install packages from the ISO repositories. Each server has two empty extra disks, `/dev/vdb` and `/dev/vdc`, 1G or bigger.

**Lab environment:**

| Host | IP address | Role | Extra disks |
|---|---|---|---|
| `server1` | `192.168.10.10` | control node + managed node | `vdb`, `vdc` |
| `server2` | `192.168.10.11` | managed node | `vdb`, `vdc` |

The addresses are examples. Replace them with your own.

**Tested on:** two CentOS Stream 10 containers with systemd (`ansible-core 2.16`, `rhel-system-roles 2.4`) in a VM. The disks were real 1G SCSI disks created by the `scsi_debug` kernel module, named `sda`/`sdb` on server1 and `sdc`/`sdd` on server2. Both containers shared the VM's kernel, so two volume groups named `vg_data` would have collided in device-mapper, and I ran the playbook on one server at a time. On two real servers you run it on both at once. A reboot wasn't part of the test, since containers don't boot. The fstab lines are the same kind as in the manual labs, where reboots were tested.

## 1. Why a role and not modules

On the command line you'd use `parted`, `pvcreate`, `vgcreate`, `lvcreate`, `mkfs` and `mount`. Ansible has modules for these (`parted`, `lvg`, `lvol`, `filesystem`), but none of them are in `ansible-core`. They're in the `community.general` collection, and `ansible-galaxy` can't download it on an air-gapped network.

The **storage** role from RHEL System Roles, installed from the ISO in [lab 2](/labs/ansible-offline-repositories/), does the whole job. You don't list steps. You describe the end state: which disk, which volumes, how big, which filesystem, where to mount. The role works out what's missing and creates it. Check that it's there:

```bash
ls /usr/share/ansible/collections/ansible_collections/redhat/rhel_system_roles/roles/ | grep storage
```

On its first run, the role installs `python3-blivet` and a few libraries on each managed server. They come from AppStream, so the repositories from lab 2 have to work.

## 2. Variables

Disk names and sizes are data, not logic, so they go into variables. Add them to the `group_vars/servers.yml` file from lab 2, under `repo_gpgkey`:

```bash
cd ~/ansible
vim group_vars/servers.yml
```

```yaml
---
repo_gpgkey: file:///etc/pki/rpm-gpg/RPM-GPG-KEY-redhat-release

backup_disk: vdb
data_disk: vdc
backup_size: 500m
data_size: 500m
swap_size: 256m
```

If one server has different disks, don't change the group file. Override only that host in `host_vars/<host>.yml`, which wins over `group_vars`. In my test the disks really were different on each server, so I had a `host_vars/server2.yml` with:

```yaml
---
backup_disk: sdc
data_disk: sdd
```

If both your servers have `vdb` and `vdc`, you don't need this file.

Check what each server will get before anything touches a disk. The quotes around `msg` are needed because of the space:

```bash
ansible all -m debug -a 'msg="{{ backup_disk }} {{ data_disk }}"'
```

```
server1 | SUCCESS => {
    "msg": "vdb vdc"
}
server2 | SUCCESS => {
    "msg": "vdb vdc"
}
```

**Check the disk names on the servers themselves**, not from memory. A wrong name in this file means the role works on the wrong disk:

```bash
ansible all -a "lsblk -d -o NAME,SIZE,TYPE"
```

## 3. The playbook

```bash
vim storage.yml
```

```yaml
---
- name: Partition, LVM and swap on every server
  hosts: servers
  become: true
  roles:
    - role: redhat.rhel_system_roles.storage
      vars:
        storage_pools:
          - name: "{{ backup_disk }}"
            type: partition
            disks:
              - "{{ backup_disk }}"
            volumes:
              - name: "1"
                type: partition
                size: "{{ backup_size }}"
                fs_type: xfs
                mount_point: /backup
          - name: vg_data
            type: lvm
            disks:
              - "{{ data_disk }}"
            volumes:
              - name: lv_data
                size: "{{ data_size }}"
                fs_type: xfs
                mount_point: /data
              - name: lv_swap
                size: "{{ swap_size }}"
                fs_type: swap
```

How to read it:

- **A pool** is a container for volumes. `type: partition` is a disk with a partition table, where volumes are partitions. `type: lvm` is a volume group, where volumes are logical volumes, and `disks` become its physical volumes.
- **`mount_point`** creates the directory, mounts the volume and writes the line to `/etc/fstab` by UUID. That's the step people forget when they do it by hand.
- **`fs_type: swap`** formats the volume as swap, turns it on and adds it to fstab. It doesn't need a mount point.
- **The partition's name is `"1"`**, its partition number, in quotes so YAML reads it as text. Section 5 shows what happens with any other name.

## 4. Run it

Check first. The role reports what it would change without touching the disks:

```bash
ansible-playbook --syntax-check storage.yml
ansible-playbook storage.yml --check
ansible-playbook storage.yml
```

The first real run, shortened (the role prints about 40 tasks):

```
TASK [redhat.rhel_system_roles.storage : Manage the pools and volumes to match the specified state] ***
changed: [server1]

TASK [redhat.rhel_system_roles.storage : Add fingerprint to /etc/fstab if present] ***
changed: [server1]

TASK [redhat.rhel_system_roles.storage : Set up new/current mounts] ************
changed: [server1] => (item={'src': 'UUID=31f299a8-...', 'path': '/backup', 'fstype': 'xfs', ... 'state': 'mounted', ...})
changed: [server1] => (item={'src': 'UUID=99c26e16-...', 'path': '/data', 'fstype': 'xfs', ... 'state': 'mounted', ...})
changed: [server1] => (item={'src': 'UUID=5789e693-...', 'path': 'none', 'fstype': 'swap', ... 'state': 'present', ...})

PLAY RECAP *********************************************************************
server1  : ok=25   changed=3    unreachable=0    failed=0    skipped=16 ...
```

On a server that runs the role for the very first time, `Make sure blivet is available` is `changed` too, because it installs the packages.

The second run:

```
PLAY RECAP *********************************************************************
server1  : ok=24   changed=0    unreachable=0    failed=0    skipped=17 ...
```

The result on the server:

```bash
ansible server1 -a "lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS /dev/vdb /dev/vdc"
```

```
NAME               SIZE FSTYPE      MOUNTPOINTS
vdb                  1G
`-vdb1             500M xfs         /backup
vdc                  1G LVM2_member
|-vg_data-lv_swap  256M swap        [SWAP]
`-vg_data-lv_data  500M xfs         /data
```

And `/etc/fstab`. The role marks the file with a comment and never touches lines it didn't write, such as the `/repo` line from lab 2:

```
# system_role:storage
UUID=31f299a8-9a94-4cd0-8d10-30e4b80bf010 /backup xfs defaults 0 0
UUID=99c26e16-70da-456e-b374-8ebd96e61a21 /data xfs defaults 0 0
UUID=5789e693-32f8-4a0d-874f-fcd9fcd8927e none swap defaults 0 0
```

## 5. The mistake I made first: a partition named "backup"

My first version gave the partition a readable name, the same way the logical volumes have one:

```yaml
            volumes:
              - name: backup
                type: partition
```

The first run worked. The second run reported `changed` and created a **second** 500M partition. The third failed:

```
"msg": "partition allocation failed for volume 'backup'"
```

```
vdb       1G
|-vdb1  500M xfs   /backup
`-vdb2  500M xfs
```

Partitions have no names that LVM or the filesystem would store, so the role has to find an existing partition some other way. Its source code accepts the device name (`vdb1`), the partition number (`1`), or a name that **ends** in a number (`backup1`). `backup` matches none of these, so on every run the role decided the partition didn't exist yet and made a new one.

The fix is `name: "1"`. If a playbook reports `changed` on a second run, something is wrong. Don't move on until it says `changed=0`.

## 6. Growing a volume

`/data` is filling up. Change one variable:

```bash
vim group_vars/servers.yml
```

```yaml
data_size: 700m
```

```bash
ansible-playbook storage.yml --check     # changed=1: it will resize
ansible-playbook storage.yml
```

The role's report (with `-v`) lists exactly two actions per server:

```
"action": "resize device",  "device": "/dev/mapper/vg_data-lv_data"
"action": "resize format",  "device": "/dev/mapper/vg_data-lv_data", "fs_type": "xfs"
```

That's `lvextend` and `xfs_growfs`, done online. `/data` stayed mounted, and a test file I'd written before was still there:

```
/dev/mapper/vg_data-lv_data  436M   34M  403M   8% /data     # before
/dev/mapper/vg_data-lv_data  636M   38M  599M   6% /data     # after
```

`df` shows less than the LV size because XFS keeps space for its own metadata.

**Shrinking doesn't work, and that's correct.** XFS can't be shrunk at all. With `data_size: 600m` the role stopped before changing anything:

```
"msg": "device 'vg_data-lv_data' must be unmounted to be resized in safe mode"
```

## 7. Swap can't grow this way

I tried the same with swap, `swap_size: 300m`:

```
PLAY RECAP *********************************************************************
server1  : ok=27   changed=0    unreachable=0    failed=0    skipped=14 ...
```

`changed=0`, no error, and the swap was still 256M. The role checks whether the volume can be resized. Swap can't, so the role **skips it without a warning**. It's the same limit as in the [manual swap lab](/labs/persistent-swap-on-lvm/), where `lvextend -r` refused to grow swap. Here you don't even get a refusal.

When you need more swap, add a second swap volume to the `vg_data` list. It has to fit in the volume group's free space. After section 6, a 1G disk has only 64M left (`ansible all -b -a "vgs vg_data"`, column `VFree`), so my test used 60M:

```yaml
              - name: lv_swap2
                size: 60m
                fs_type: swap
```

The role creates it, turns it on and adds it to fstab, and the next run is `changed=0`. `swapon --show` then lists both. To remove it later, add `state: absent` to it. The role turns the swap off, deletes the LV and removes its fstab line.

## 8. Safe mode: a disk that isn't empty

By default the role runs in **safe mode** (`storage_safe_mode: true`): it refuses to format or remove anything that already exists. To test it, I put an XFS filesystem with a file on `server2`'s data disk before the first run:

```
fatal: [server2]: FAILED! => {... "msg": "cannot remove existing formatting (xfs) and/or devices on disk 'vdc' (pool 'vg_data') in safe mode" ...}
```

The file was still there afterward. The other disk wasn't touched either, even though it was empty and valid: the role plans all the changes first and only then writes to disk, so a failure on one pool means no changes at all.

If you're **sure** the old data can go, wipe the disk yourself, by name, on that one server, then run the playbook again:

```bash
ansible server2 -b -a "wipefs -a /dev/vdc"
```

Don't set `storage_safe_mode: false` in the playbook to get past this. It would stay there for every later run.

## Verification

From `~/ansible` on `server1`:

```bash
ansible all -a "lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS /dev/vdb /dev/vdc"   # vdb1 on /backup, lv_data on /data, lv_swap [SWAP]
ansible all -b -a "findmnt --verify"                  # 0 errors (needs root to read the disks)
ansible all -a "swapon --show"                        # lv_swap active
ansible all -b -a "vgs vg_data"                       # one VG on each server
ansible all -b -m shell -a "touch /data/test && touch /backup/test && echo ok"   # both writable
ansible-playbook storage.yml                          # changed=0 on both
```

On a real server, reboot one of them and run the `lsblk` line again. Everything should be mounted without any help.

## Safety notes

- **Check disk names on every server before the first run** (`lsblk`). The role does exactly what the variables say, on whatever disk they name.
- **Run `--check` before every real run.** In my tests it correctly reported a planned resize as `changed=1`.
- **Leave `storage_safe_mode` on.** It's the only thing between a wrong disk name and a formatted disk with data on it.
- **Safe mode doesn't protect against `state: absent`.** That's an explicit request, and the role carries it out: the volume and the data on it are gone.
- **`changed` on a second run is a bug in the playbook.** Section 5 shows how a wrong partition name turned that into a full disk.
- **Swap size changes are skipped without an error.** Check `swapon --show` after changing it, or add a new swap volume instead.
