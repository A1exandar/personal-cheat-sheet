+++
title = "LVM Cheat Sheet"
date = 2026-10-17
description = "Logical Volume Management: physical volumes, volume groups, and logical volumes - creating each layer, extending a logical volume (the classic RHCSA task), growing the volume group first when needed, and the much riskier, XFS-incompatible process of shrinking one."
tags = ["linux", "lvm", "storage", "rhel", "sysadmin"]
+++

LVM adds a flexible layer between raw disks and filesystems: a logical volume can be resized, span multiple physical disks, and be grown online, none of which a plain partition can do. The tradeoff is three layers of naming instead of one - see [`lsblk`](/sheets/linux-disk-check/#lsblk) for viewing where everything sits once it exists.

## The three layers

```text
Physical Volume (PV)   a whole disk or partition, initialized for LVM to use
        |
Volume Group (VG)      a pool combining one or more PVs into one block of space
        |
Logical Volume (LV)    a resizable "virtual partition" carved out of a VG's space
```

A VG can span several physical disks, and a single LV can use space from anywhere in that pool - this is what makes "add another disk and grow the existing volume" possible without ever touching the filesystem's original disk.

## Creating a physical volume

```bash
sudo pvcreate /dev/sdb       # initialize the whole disk for LVM use
pvs                              # list PVs - short form
sudo pvdisplay /dev/sdb            # list PVs - full detail on one
```

> `pvcreate` writes an LVM label to the start of the device, destroying any existing partition table or filesystem signature there - double-check the device name against `lsblk` immediately before running it. There's no confirmation prompt.

## Creating a volume group

```bash
sudo vgcreate vg_data /dev/sdb   # create a VG, seeded with one PV
vgs                                 # list VGs - short form
sudo vgdisplay vg_data                # list VGs - full detail on one
```

## Creating a logical volume

```bash
sudo lvcreate -L 20G -n lv_apps vg_data   # a 20G LV named lv_apps, carved from vg_data
sudo lvcreate -l 100%FREE -n lv_apps vg_data   # use every byte currently free in the VG instead
lvs                                           # list LVs - short form
```

> Leaving some space unallocated in the VG when first creating an LV (rather than `100%FREE` immediately) is usually the better call - growing an existing LV later is trivial; shrinking one is not (see the warning near the bottom).

## Putting a filesystem on it and mounting

```bash
sudo mkfs.xfs /dev/vg_data/lv_apps       # format the LV - XFS is the RHEL default
sudo mkdir -p /mnt/data
sudo mount /dev/vg_data/lv_apps /mnt/data   # mount it once, to confirm it works
```

```bash
echo "/dev/vg_data/lv_apps  /mnt/data  xfs  defaults  0 0" | sudo tee -a /etc/fstab   # persist across reboots
sudo mount -a                                                                            # test the fstab entry now, don't wait for a reboot to find a typo
```

> The `/dev/vg_name/lv_name` path is stable on its own - unlike raw partitions (`/dev/sdb1`), which can shift if disks get re-enumerated in a different order, an LV's mapper path doesn't depend on which physical disk happens to be `/dev/sdb` this boot. A UUID (`blkid`) works too, but for LVM the mapper path is already safe to use directly.

## Extending a logical volume - the classic RHCSA task

```bash
sudo lvextend -L +5G /dev/vg_data/lv_apps   # grow the LV by 5G (note the +, relative to current size)
```

```bash
sudo xfs_growfs /mnt/data              # XFS: takes the MOUNT POINT, not the device - grows to fill the LV
sudo resize2fs /dev/vg_data/lv_apps      # ext4: takes the DEVICE path instead - also works while mounted
```

```bash
sudo lvextend -r -L +5G /dev/vg_data/lv_apps   # -r (--resizefs) does both steps above in one command
```

The LV and the filesystem living on it are resized separately - growing the LV alone doesn't make the extra space usable until the filesystem itself is told to expand into it. `-r` on `lvextend` automates that second step for either filesystem type, which is why it's worth using even once the manual two-step version is understood.

## Extending the volume group first

```bash
sudo pvcreate /dev/sdc              # bring a newly added disk into LVM
sudo vgextend vg_data /dev/sdc        # add it to the existing VG's pool of space
vgs                                      # confirm VG size grew
```

Only needed when the VG itself is out of free space to give an LV - if `vgs` still shows free space, skip straight to `lvextend`.

## Reducing a logical volume - handle with real care

```bash
sudo umount /mnt/data                         # ext4 shrink requires unmounting first
sudo e2fsck -f /dev/vg_data/lv_apps             # check the filesystem before resizing it
sudo resize2fs /dev/vg_data/lv_apps 10G           # shrink the FILESYSTEM first, to the target size
sudo lvreduce -L 10G /dev/vg_data/lv_apps           # only now shrink the LV itself, to match
```

```bash
sudo lvreduce -r -L 10G /dev/vg_data/lv_apps   # -r handles the correct order automatically, for ext2/3/4
```

The order is the **exact reverse** of extending: shrink the filesystem down first, then shrink the LV to match - never the other way around, and never on XFS at all (see Safety notes).

## Common recipes

```bash
# Full picture of every layer at once
lsblk
pvs
vgs
lvs

# Grow a volume that's running out of space, filesystem included, in one line
sudo lvextend -r -L +10G /dev/vg_data/lv_apps

# Add a whole new disk's worth of space to an existing, already-mounted volume
sudo pvcreate /dev/sdc
sudo vgextend vg_data /dev/sdc
sudo lvextend -r -l +100%FREE /dev/vg_data/lv_apps
```

## Safety notes

- **XFS cannot shrink, ever** - `xfs_growfs` only grows. The only way to make an XFS logical volume smaller is backup the data, destroy and recreate the LV at the new size, format, and restore - plan LV sizes generously on XFS rather than relying on shrinking later.
- `pvcreate` destroys whatever was on that device with no confirmation - run `lsblk` immediately beforehand and read the device name twice.
- When extending: grow the LV, *then* the filesystem. When reducing (ext4/ext3 only): shrink the filesystem, *then* the LV. Reversing either order risks data loss - `lvreduce -r` / `lvextend -r` exist specifically to never get this backwards.
- Test a new `/etc/fstab` entry with `sudo mount -a` immediately - an entry with a typo or wrong path only reveals itself at boot time otherwise, which can mean a system that won't come back up cleanly after a reboot.
- Back up before any shrink operation - even done in the correct order, a miscalculated target size on a shrink is one of the few LVM operations that genuinely risks data loss.
