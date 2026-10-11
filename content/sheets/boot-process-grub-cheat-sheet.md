+++
title = "Boot Process & GRUB Cheat Sheet"
date = 2026-10-11
description = "From power-on to a login prompt: systemd targets (the modern equivalent of runlevels), systemctl isolate/get-default/set-default, GRUB2 configuration and regeneration, and the classic rd.break procedure for resetting a lost root password."
tags = ["linux", "boot", "grub", "systemd", "sysadmin"]
+++

What actually happens between pressing the power button and reaching a login prompt, how to change what a system boots into, and how to get back in when something in that chain is broken. For day-to-day service management (start/stop/enable one unit), see the [systemctl cheat sheet](/sheets/systemctl/) first - this one is about boot targets and the bootloader itself.

## The boot sequence, at a glance

```text
Firmware (BIOS/UEFI)   -> finds and runs the bootloader
GRUB2                  -> loads the kernel and initramfs into memory, hands off control
Kernel + initramfs     -> kernel initializes hardware; initramfs finds and mounts the real root filesystem
systemd (PID 1)        -> takes over, starts units in dependency order toward a target
Target reached          -> e.g. a graphical login screen, or a plain text login prompt
```

Each stage can fail independently, which is why troubleshooting a boot problem starts with figuring out *which* stage it actually got stuck at (GRUB menu never appears vs. a kernel panic vs. systemd hanging on one unit) rather than guessing.

## systemd targets - the modern equivalent of runlevels

```text
Old SysV runlevel   systemd target        Meaning
0                   poweroff.target       Shut down
1                   rescue.target         Single-user mode, local filesystems mounted, minimal services
2, 3, 4             multi-user.target     Full multi-user, text-mode login, networking up
5                   graphical.target      multi-user.target plus a display manager / GUI login
6                   reboot.target         Reboot
-                   emergency.target      Even more minimal than rescue - no filesystems mounted at all
```

```bash
systemctl get-default                     # which target this box boots into by default
systemctl list-units --type=target        # every active target right now
```

## Switching targets immediately with systemctl isolate

```bash
sudo systemctl isolate multi-user.target   # drop a graphical desktop to a text console, right now
sudo systemctl isolate rescue.target         # go to single-user-equivalent mode, right now
```

> `isolate` stops every unit not required by the target you're switching to - dropping from `graphical.target` to `multi-user.target` on a desktop kills the display manager and every GUI session immediately. Dropping to `rescue.target` or `emergency.target` **on a remote box over SSH** can kill networking and your own session along with it - only do this from a console you can't lose, or a system you can reach another way.

## Setting the default boot target permanently

```bash
sudo systemctl set-default multi-user.target   # this server boots to text mode from now on
sudo systemctl set-default graphical.target      # this workstation boots to a GUI login from now on
systemctl get-default                              # confirm the change took
```

`set-default` just rewrites a symlink (`/etc/systemd/system/default.target`) pointing at the real target file - it doesn't take effect until the next reboot, unlike `isolate` which acts immediately but isn't persistent.

## GRUB2 configuration

```bash
sudo nano /etc/default/grub   # the file you actually edit
```

```text
GRUB_TIMEOUT=5                            # seconds the menu waits before booting the default entry
GRUB_DEFAULT=saved                          # boot whichever entry was last selected, instead of always entry 0
GRUB_CMDLINE_LINUX="quiet rhgb"               # extra kernel parameters passed on every boot
GRUB_DISABLE_SUBMENU=true                       # flatten older-kernel entries instead of nesting them in a submenu
```

```bash
sudo grub2-mkconfig -o /boot/grub2/grub.cfg          # RHEL/Fedora/CentOS - regenerate the real config from the file above
sudo update-grub                                       # Debian/Ubuntu - wrapper around the equivalent grub-mkconfig call
```

> Never hand-edit `/boot/grub2/grub.cfg` (or `/boot/grub/grub.cfg` on Debian/Ubuntu) directly - it's a generated file, and the next kernel update or `grub2-mkconfig` run overwrites it completely, silently discarding any manual changes. Edit `/etc/default/grub`, then regenerate.

## Editing boot parameters for a single boot, at the GRUB menu

```text
At the GRUB menu:
  Shift (BIOS) or Esc (some UEFI systems)   show the menu if it's hidden/auto-booting
  e                                            edit the highlighted entry's commands before booting
  Ctrl+x  or  F10                                boot with the edited commands
  Ctrl+a / Ctrl+e                                   move to start/end of a line while editing
```

Anything typed here applies to **this boot only** - it's never saved back to `/etc/default/grub` or `grub.cfg`, making it the safe way to test a kernel parameter or attempt a recovery boot without risking a permanently broken configuration.

## Recovery: booting straight to a rescue or emergency target

At the GRUB edit screen, find the line starting with `linux` (or `linuxefi`) and append one of:

```text
systemd.unit=rescue.target       # local filesystems mounted, asks for the root password
systemd.unit=emergency.target      # even more minimal - no filesystems mounted, for when rescue itself won't boot
```

Then `Ctrl+x` to boot. Useful when a broken `/etc/fstab` entry or a failing unit is preventing a normal boot from ever reaching a login prompt.

## Recovery: resetting a lost root password with rd.break

The standard RHEL/CentOS/Fedora procedure - this one is worth knowing by heart, not just looking up:

```bash
# 1. At the GRUB edit screen, append to the "linux" line, then Ctrl+x:
rd.break
```

```bash
# 2. Boot drops into an early initramfs shell with the real root filesystem
#    mounted read-only at /sysroot - remount it read-write first:
mount -o remount,rw /sysroot

# 3. Change root into the real filesystem:
chroot /sysroot

# 4. Now a normal passwd command works against the real system:
passwd root

# 5. Force an SELinux relabel on next boot - see the Safety notes below for why
#    this step is not optional on an SELinux-enforcing system:
touch /.autorelabel

# 6. Leave the chroot, then leave the initramfs shell, to continue booting:
exit
exit
```

The reboot after this will take noticeably longer than normal - that's the full SELinux filesystem relabel from step 5 running, and is expected.

## Repairing GRUB itself after it won't boot at all

```bash
# booted from installation/rescue media, with the real system mounted at /mnt/sysimage or similar:
sudo chroot /mnt/sysimage
grub2-install /dev/sda                       # reinstall the GRUB bootloader to the disk's boot sector
grub2-mkconfig -o /boot/grub2/grub.cfg          # regenerate its configuration from scratch
```

## Common recipes

```bash
# What target does this box boot into, and what's it in right now?
systemctl get-default
systemctl list-units --type=target --no-legend

# Drop a server to a stable text console to troubleshoot a flaky display manager
sudo systemctl isolate multi-user.target

# Make a kernel parameter change permanent after confirming it works via a one-time GRUB edit
sudo nano /etc/default/grub                      # add the parameter to GRUB_CMDLINE_LINUX
sudo grub2-mkconfig -o /boot/grub2/grub.cfg          # bake it into every future boot
```

## Safety notes

- **`touch /.autorelabel` is not optional** after an `rd.break` password reset on an SELinux-enforcing system - `chroot`-ing in and editing `/etc/shadow` happens with SELinux inactive, so the file ends up with a security context that doesn't match policy. Skip this step and the very next boot can refuse login entirely (or misbehave in ways that look unrelated to the password reset), long after the actual cause has been forgotten.
- Never hand-edit a generated `grub.cfg` - changes belong in `/etc/default/grub`, followed by `grub2-mkconfig`/`update-grub`. A manual edit survives right up until the next kernel update silently overwrites it.
- `systemctl isolate rescue.target` or `emergency.target` on a box only reachable over SSH can end the very session used to run the command - confirm out-of-band console access exists first, or practice this on a VM/lab box, not production.
- GRUB menu edits made at boot time are one-boot-only by design - if a "fix" needs testing, test it there first; only write it into `/etc/default/grub` once it's confirmed to actually work.
- Keep a copy of a working `/boot/grub2/grub.cfg` (or know how to regenerate one from a rescue environment) before any bootloader-level experiment - a system that won't get past GRUB at all needs rescue/installation media to recover, which is a very different, slower process than fixing a target or a unit from a normal boot.
