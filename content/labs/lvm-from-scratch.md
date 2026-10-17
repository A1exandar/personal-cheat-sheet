+++
title = "Setting Up LVM on a New Disk, From Scratch"
date = 2026-10-17
description = "A new disk, built into usable storage through all three LVM layers (PV -> VG -> LV), formatted, mounted persistently via /etc/fstab, and - the part that's the actual point of LVM - extended later with a second disk, with the original data confirmed intact afterward."
tags = ["linux", "lvm", "storage", "rhel", "sysadmin"]
+++

**Goal:** take a brand-new, completely unused disk and turn it into mounted, persistent storage through all three LVM layers - then, later, add a second disk and grow the volume into it live, proving the entire point of using LVM over a plain partition in the first place.

**Why the extend step matters as much as the setup:** building PV → VG → LV once is only half the exercise. The real value of LVM only shows up the day storage runs low and the answer is "add a disk and grow the volume" instead of "back everything up, repartition, restore, hope nothing was missed" - this walkthrough proves that path actually works, including confirming the original data survives the resize untouched.

## 1. Identify the new disk - and confirm it's actually unused

```bash
lsblk                     # find the new disk - likely /dev/sdb, with no partitions or filesystem shown
sudo blkid /dev/sdb         # empty output confirms no existing filesystem signature - safe to proceed
```

> `pvcreate` in the next step destroys anything already on this device without asking. Confirming via both `lsblk` and `blkid` - not just one - is worth the extra few seconds given there's no undo.

## 2. Create the physical volume

```bash
sudo pvcreate /dev/sdb
pvs   # confirm it shows up, with the full disk size available
```

## 3. Create the volume group

```bash
sudo vgcreate vg_data /dev/sdb
vgs   # confirm the VG exists with the expected total size
```

## 4. Create the logical volume - deliberately not using all the space yet

```bash
sudo lvcreate -L 20G -n lv_apps vg_data   # 20G now, leaving the rest of the VG free on purpose
vgs      # VFree now shows the remaining unallocated space in the VG
lvs      # the new LV, sized exactly as requested
```

Leaving free space in the VG now is what makes section 7's extend possible without a second disk yet, and mirrors realistic practice - it's normal to not allocate every byte of a VG to a single LV immediately.

## 5. Format, mount, and make it persistent

```bash
sudo mkfs.xfs /dev/vg_data/lv_apps
sudo mkdir -p /mnt/data
sudo mount /dev/vg_data/lv_apps /mnt/data
df -h /mnt/data                                # confirm it's mounted at the expected size
```

```bash
echo "/dev/vg_data/lv_apps  /mnt/data  xfs  defaults  0 0" | sudo tee -a /etc/fstab
sudo umount /mnt/data                            # unmount manually
sudo mount -a                                      # then let fstab remount it - proves the entry works
df -h /mnt/data                                      # should show the same mount, now via fstab
```

`mount -a` after manually unmounting is standing in for a reboot here - it's the fastest way to catch an `/etc/fstab` typo immediately, rather than discovering it the next time the system actually restarts.

## 6. Write something worth protecting

```bash
echo "This file must survive the resize in section 7." | sudo tee /mnt/data/proof.txt
cat /mnt/data/proof.txt
```

This file is the thread the rest of the lab pulls on - its survival through everything that follows is the actual proof that online resizing is safe, not just a claim to take on faith.

## 7. Add a second disk and extend the volume group

```bash
lsblk                         # confirm the new second disk, e.g. /dev/sdc
sudo pvcreate /dev/sdc
sudo vgextend vg_data /dev/sdc
vgs   # VSize has grown - the VG now spans two physical disks
```

## 8. Extend the logical volume into the new space

```bash
sudo lvextend -r -l +100%FREE /dev/vg_data/lv_apps   # grow the LV to use all newly available space, and resize the filesystem in the same command
```

```bash
df -h /mnt/data          # the mounted filesystem is already larger - no unmount, no reboot
```

The `-r` flag is what makes this a single command instead of two - without it, `lvextend` alone would grow the LV but leave the filesystem itself still reporting the old, smaller size until `xfs_growfs` is run separately.

## Verification - prove the data survived, not just that the size changed

```bash
cat /mnt/data/proof.txt       # the exact file from section 6, untouched
lsblk                            # the full stack: disk -> PV -> VG -> LV -> mountpoint, consistent top to bottom
vgs; lvs                           # VG now spans 2 PVs; LV size matches df -h's number
sudo mount -a                         # re-run once more - a silent, no-error result confirms fstab is still correct
```

Seeing `proof.txt` intact after an unmount/remount cycle and a live resize across two disks is the actual demonstration here - the size numbers alone only prove the commands ran, not that the data riding along with them was ever safe.

## Safety notes

- `pvcreate` has no confirmation prompt and destroys whatever is already on the device - always re-check with `lsblk`/`blkid` immediately before running it, every time, not just the first time.
- Leaving free space in a VG when first sizing an LV costs nothing and avoids a same-day need to find more storage - `100%FREE` at creation time is rarely the right call for a volume expected to grow.
- `/dev/vg_name/lv_name` paths are stable regardless of which raw disk SCSI happens to enumerate as `/dev/sdb` this boot - this is part of why LVM is preferable to raw partitions for anything long-lived, on top of the resizing itself.
- Test every `/etc/fstab` change with `mount -a` in the same session it was made - an untested entry only fails at the worst possible time, during a boot with no one watching.
- This lab only ever grows - see the [LVM cheat sheet's reduce section](/sheets/lvm-cheat-sheet/#reducing-a-logical-volume---handle-with-real-care) before ever shrinking a real volume; the order of operations is the exact reverse of extending, and XFS (used throughout this lab) cannot be shrunk at all.
