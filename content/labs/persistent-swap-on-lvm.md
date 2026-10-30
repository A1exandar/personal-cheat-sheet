+++
title = "Adding Persistent Swap on an LVM Logical Volume"
date = 2026-10-31
description = "Extra swap carved out of the vg_data volume group from the LVM lab: a new logical volume, mkswap, swapon, a priority higher than the existing swap, an /etc/fstab entry tested with swapon -a (mount -a ignores swap), and growing it later - including why lvextend -r refuses swap and a mkswap that has to be rerun."
tags = ["linux", "lvm", "swap", "storage", "rhel", "rhcsa", "sysadmin"]
+++

**Goal:** add 2 GiB of swap to a RHEL system as a new logical volume in `vg_data` - the volume group built in the [LVM from scratch lab](/labs/lvm-from-scratch/) - keep the swap the installer created, make the new one survive a reboot, and later grow it without breaking anything.

**Why on LVM and not a swap file or partition:** a partition can't be resized without repartitioning, and a swap file depends on the filesystem underneath it. A logical volume can be grown later the same way as any other LV, and its `/dev/vg_data/lv_swap` path never changes. It's also how RHEL itself does it - a default install already puts its swap on LVM, as `rhel/swap`.

**Tested on:** a Linux VM with lvm2 and util-linux, the same tools RHEL 10 uses, on throwaway loop-device disks. Every command and output below comes from that run, except the final reboot - loop devices don't survive one - so the Verification section shows what to expect rather than captured output. Device numbers like `dm-2`, and the sizes, will differ on another system.

## 1. Look at the starting point

```bash
free -h
swapon --show
vgs
```

```text
NAME      TYPE       SIZE USED PRIO
/dev/dm-0 partition 1024M   0B   -1
  VG      #PV #LV #SN Attr    VSize  VFree
  rhel      1   1   0 wz--n-- <3.00g <2.00g
  vg_data   1   1   0 wz--n-- <3.00g     0
```

One swap device is already active - the installer's `rhel/swap`, shown by its device-mapper name `dm-0`. `vg_data` has `VFree` of `0`: the LVM lab ended with `lv_apps` taking every free extent. The new swap needs space from somewhere first.

## 2. Make room in the volume group

Add another disk to `vg_data`, exactly as in the LVM lab:

```bash
lsblk                        # find the new, empty disk - here /dev/sdd
sudo blkid /dev/sdd          # empty output = no existing signature
sudo pvcreate /dev/sdd
sudo vgextend vg_data /dev/sdd
vgs vg_data
```

```text
  VG      #PV #LV #SN Attr    VSize VFree
  vg_data   2   1   0 wz--n-- 5.99g <3.00g
```

If `VFree` is already big enough on your system, skip this step.

## 3. Create the logical volume and format it as swap

```bash
sudo lvcreate -L 2G -n lv_swap vg_data
sudo mkswap /dev/vg_data/lv_swap
```

```text
  Logical volume "lv_swap" created.
Setting up swapspace version 1, size = 2 GiB (2147479552 bytes)
no label, UUID=43308a47-5f98-4142-8eac-1b485b70ea27
```

`mkswap` writes a swap signature - the swap equivalent of `mkfs`. Without it, `swapon` refuses the device.

> **`mkswap` doesn't ask before overwriting.** Pointed at the wrong LV - say `lv_apps` instead of `lv_swap` - it prints `warning: wiping old xfs signature`, then does it anyway, and the data on that LV is gone. Check the path twice. The one case it does refuse is a swap device that's currently active.

## 4. Turn it on and look

```bash
sudo swapon /dev/vg_data/lv_swap
swapon --show
free -h
```

```text
NAME      TYPE       SIZE USED PRIO
/dev/dm-0 partition 1024M   0B   -1
/dev/dm-2 partition    2G   0B   -1
               total        used        free
Swap:          3.0Gi          0B       3.0Gi
```

Both swap devices are active, and the total went from 1 GiB to 3 GiB. This only lasts until the next reboot - nothing records it yet.

## 5. Make it persistent in /etc/fstab

```bash
echo "/dev/vg_data/lv_swap  none  swap  defaults,pri=10  0 0" | sudo tee -a /etc/fstab
```

- `none` in the mount point column - swap isn't mounted anywhere.
- `swap` as the type is what tells the system to activate it with `swapon` at boot instead of mounting it.
- `pri=10` - see section 6.
- The LV path instead of `UUID=...` is deliberate - section 7 shows why.

Now test the entry. The usual fstab test is the wrong one here:

```bash
sudo swapoff /dev/vg_data/lv_swap
sudo mount -a
swapon --show
```

```text
NAME      TYPE       SIZE USED PRIO
/dev/dm-0 partition 1024M   0B   -1
```

**`mount -a` skips swap entries completely.** No error, no output, and the new swap is still off - the entry could contain a typo and `mount -a` would never show it. The command that reads the swap lines from fstab is `swapon -a`:

```bash
sudo swapon -a
swapon --show
```

```text
NAME      TYPE       SIZE USED PRIO
/dev/dm-0 partition 1024M   0B   -1
/dev/dm-2 partition    2G   0B   10
```

Then let systemd pick up the new entry and check the file as a whole:

```bash
sudo systemctl daemon-reload
findmnt --verify                                 # Success, no errors or warnings detected
systemctl status dev-vg_data-lv_swap.swap        # Loaded: loaded (/etc/fstab; generated)
```

At boot, systemd turns each swap line in fstab into a `.swap` unit like this one. `findmnt --verify` without the `daemon-reload` first reports a warning that systemd is still using the old version of fstab.

## 6. Swap priority - which device gets used first

The `PRIO` column above changed from `-1` to `10`. The kernel fills swap devices in order of priority, highest first. Devices without an explicit priority get a negative one. Devices with the same priority are used in parallel, round-robin.

With `pri=10`, the new LV is used first, and the installer's swap only after it fills up. That's useful when the two sit on different disks and one is faster. Leave `pri=` out to keep both at the same level.

Note that `pri=10` only applies when the swap is turned on through fstab - by `swapon -a` or at boot. A manual `swapon /dev/vg_data/lv_swap` ignores fstab and gives it the default priority - which is why every re-activation in section 7 goes through `swapon -a`.

## 7. Growing the swap later

Growing a filesystem LV is one command - `lvextend -r`. For swap, it isn't:

```bash
sudo lvextend -r -L +512M /dev/vg_data/lv_swap
```

```text
  File system extend is not supported (swap).
```

The command fails, and the LV isn't extended at all - `lvs` still shows `2.00g`. Without `-r`, the LV does grow, even while the swap is active:

```bash
sudo lvextend -L +512M /dev/vg_data/lv_swap
lvs vg_data/lv_swap          # 2.50g
swapon --show                # still 2G
```

The kernel keeps using the size written in the swap signature when `mkswap` ran. Even turning the swap off and on again doesn't change that:

```bash
sudo swapoff /dev/vg_data/lv_swap
sudo swapon -a
swapon --show                # still 2G - the LV is bigger, the swap isn't
```

The extra space only becomes swap after a new `mkswap`, which has to run while the swap is off:

```bash
sudo swapoff /dev/vg_data/lv_swap
sudo mkswap /dev/vg_data/lv_swap
sudo swapon -a
swapon --show
```

```text
mkswap: /dev/vg_data/lv_swap: warning: wiping old swap signature.
Setting up swapspace version 1, size = 2.5 GiB (2684350464 bytes)
NAME      TYPE       SIZE USED PRIO
/dev/dm-0 partition 1024M   0B   -1
/dev/dm-2 partition  2.5G   0B   10
```

**Every `mkswap` generates a new UUID.** In this run, the UUID changed from `43308a47-...` to `0f830b70-...`. An fstab line written as `UUID=43308a47-...` would now point at nothing:

```text
swapon: cannot find the device for UUID=43308a47-5f98-4142-8eac-1b485b70ea27
```

That's why section 5 uses `/dev/vg_data/lv_swap`: the LV path stays the same through any number of `mkswap` runs. If an existing fstab uses the UUID, either update it after `mkswap`, or keep the old one with `mkswap -U <old-uuid> /dev/vg_data/lv_swap`.

## Verification - prove it survives a reboot

```bash
sudo reboot
```

After the system is back:

```bash
swapon --show                                  # both devices, lv_swap at 2.5G with PRIO 10
free -h                                        # Swap total 3.5Gi
systemctl status dev-vg_data-lv_swap.swap      # active, loaded from /etc/fstab
lsblk /dev/sdd                                 # disk -> vg_data-lv_swap -> [SWAP]
```

If `lv_swap` is missing after the reboot, check `journalctl -b -u dev-vg_data-lv_swap.swap` - the unit's log says whether the device wasn't found or the swap signature was rejected.

## Safety notes

- `mkswap` overwrites whatever is on the target without a prompt, other than a warning printed after the decision is already made. Double-check the LV path before running it, every time.
- Test swap entries in fstab with `swapon -a`, not `mount -a`. `mount -a` ignores them, so a broken swap line passes that test silently.
- `swapoff` moves everything in that swap device back into RAM. On a system under memory pressure, check `free -h` first - if what's swapped out doesn't fit in free RAM, `swapoff` can hang or wake the OOM killer.
- Don't run `mkswap` on a swap device that's in use. It refuses with `is mounted; will not make swapspace` - turn it off with `swapoff` first.
- After every `mkswap`, the UUID is new. Anything that refers to the swap by UUID - fstab, or a `resume=` option for hibernation on the kernel command line - has to be updated, or use the LV path instead.
- More swap isn't a fix for a system that's constantly short on memory - it turns an out-of-memory crash into a very slow system. Watch the `si`/`so` columns in `vmstat` (see the [disk check cheat sheet's swap section](/sheets/linux-disk-check/#swap-usage)) to tell occasional swap use from constant paging.
