+++
title = "Resetting a Lost Root Password on RHEL 10, Step by Step"
date = 2026-10-28
description = "The rd.break procedure done for real on a VM: interrupting GRUB, dropping into the initramfs shell, remounting /sysroot, changing the password inside a chroot, and handling SELinux correctly - with a full relabel or the faster enforcing=0 + restorecon route - then locking the door with a GRUB password."
tags = ["linux", "rhel", "boot", "grub", "selinux", "rhcsa", "sysadmin"]
+++

**Goal:** get back into a RHEL 10 system whose root password nobody knows, using only console access - no installation media, no rescue ISO - and leave the system in a state where SELinux is still enforcing and nothing is mislabeled afterward.

**Why do it as a lab, not just read it:** the [boot process cheat sheet](/sheets/boot-process-grub-cheat-sheet/#recovery-resetting-a-lost-root-password-with-rdbreak) has the six commands. What it can't show is everything around them: getting into the GRUB menu at all when it flashes past in a second, where exactly `rd.break` goes, which prompt you're actually at, and what happens when the SELinux step is skipped. That's where this goes wrong under pressure - on an exam, or at 2 a.m. on a locked-out server.

**Do this on a VM.** Every step needs the system's console (the VM window, or a server's iLO/iDRAC/serial console) - SSH is gone the moment the system reboots, and it won't come back until the procedure is finished.

## 1. Set up the scenario - lose the password on purpose

```bash
sudo passwd root                      # set a known password first, so the "before" state is clear
sudo cp /etc/shadow /root/shadow.lab-bak  # optional undo for the lab only - never needed in real life
echo "root:$(openssl rand -base64 24)" | sudo chpasswd   # replace it with a random one nobody has seen
sudo reboot
```

From here on, the root password is genuinely unknown. At the console login prompt, `root` with the old password now fails - which is the situation the rest of the lab gets out of.

## 2. Interrupt GRUB and edit the boot entry

When the GRUB menu appears, press any arrow key straight away to stop the countdown. If no menu shows up at all (it can be hidden on some installs), hold **Shift** (BIOS) or press **Esc** repeatedly (UEFI) right after the firmware screen.

With the default (top) entry highlighted, press **e**. Find the line that starts with `linux`:

```text
linux ($root)/vmlinuz-6.12.0-55.el10.x86_64 root=/dev/mapper/rhel-root ro crashkernel=... resume=/dev/mapper/rhel-swap rd.lvm.lv=rhel/root rd.lvm.lv=rhel/swap rhgb quiet
```

Move to the end of that line (**Ctrl+e**) and append `rd.break`, separated by a space:

```text
... rd.lvm.lv=rhel/swap rhgb quiet rd.break
```

Press **Ctrl+x** to boot with the edited line. The edit applies to this one boot only - nothing is written to disk, so a mistake here is fixed by simply rebooting and trying again.

`rd.break` tells the initramfs to stop just before it hands control to the real system - after the real root filesystem has been found and mounted, but before anything on it, including the login prompt, has started.

## 3. Find out where you actually are

```text
switch_root:/#
```

This is a root shell inside the initramfs - no password was asked, which is exactly why this works. The real system is mounted at `/sysroot`, read-only:

```bash
mount | grep sysroot          # ... on /sysroot type xfs (ro,...)
ls /sysroot                     # the real system's /etc, /home, /var ...
```

Every command from here until the end of section 5 runs as root already - there's no `sudo`, and none is needed.

## 4. Remount /sysroot read-write and enter it

```bash
mount -o remount,rw /sysroot     # without this, passwd fails: "Authentication token manipulation error"
chroot /sysroot                    # from now on, / is the real system, not the initramfs
```

The prompt changes to `sh-5.2#` - that's the real system's shell, running inside the chroot. Skipping the chroot doesn't work: the initramfs is a minimal environment of its own, and even where it has a `passwd` command at all, it would act on the initramfs's own `/etc` - not the `/etc/shadow` the real system boots with.

## 5. Set the new password and handle SELinux

```bash
passwd root                      # the real /etc/shadow, rewritten with the new password
touch /.autorelabel                # schedule a full SELinux relabel for the next boot
exit                                 # leave the chroot
exit                                   # leave the initramfs shell - boot continues
```

`passwd` doesn't edit `/etc/shadow` in place - it writes a new file and renames it over the old one. Normally SELinux labels that new file correctly as it's created, but SELinux isn't running at this stage of boot, so the new `/etc/shadow` ends up with no proper label. On an enforcing system, that means login - which has to read `/etc/shadow` - is denied, even with the correct password.

`/.autorelabel` fixes this by relabeling the entire filesystem on the next boot. Expect that boot to take several minutes, and to reboot once more by itself when it's done. Don't interrupt it.

## 6. Log in and verify

At the console login prompt, log in as `root` with the new password.

```bash
getenforce                     # Enforcing - SELinux was never turned off
ls -Z /etc/shadow                # system_u:object_r:shadow_t:s0 - the correct label
ls /.autorelabel                   # "No such file" - the relabel ran and removed it
sudo ausearch -m AVC -ts boot        # no denials since this boot
```

If the login fails with the right password, `/etc/shadow` almost certainly has the wrong label - which means `/.autorelabel` was skipped or mistyped. See the next section for fixing that without starting over.

## 7. The faster alternative - for large filesystems

A full relabel walks every file on every filesystem. On a VM that takes minutes; on a server with millions of files it can take much longer. Since only one file was changed, relabeling just that one file is enough:

At the GRUB edit screen, append **both** options this time:

```text
... rhgb quiet rd.break enforcing=0
```

```bash
mount -o remount,rw /sysroot
chroot /sysroot
passwd root
exit
exit                           # no /.autorelabel this time - boot continues in permissive mode
```

After logging in as root:

```bash
restorecon -v /etc/shadow        # relabels just this one file - prints the label change it made
setenforce 1                       # back to enforcing, immediately
getenforce                           # Enforcing
```

`enforcing=0` boots in permissive mode: SELinux still logs what it would deny, but doesn't block it, so the mislabeled `/etc/shadow` can't lock you out. It only applies to this boot - the next reboot is enforcing again even if `setenforce 1` is forgotten - but don't leave a system permissive any longer than these three commands take.

## Closing the door - why this works, and how to block it

Everything above worked without knowing any password, because anyone at the console can edit the boot line. On a server in a locked data center that's usually acceptable. On a machine anyone can reach the console of, it's a complete bypass of every account password on the system. A GRUB password closes it:

```bash
sudo grub2-setpassword          # prompts for a password - creates /boot/grub2/user.cfg
sudo cat /boot/grub2/user.cfg     # GRUB2_PASSWORD=grub.pbkdf2.sha512... - a hash, never the password itself
```

After a reboot, the system still boots normally with no password, but pressing **e** at the GRUB menu now asks for the `root` user and the GRUB password before allowing any edit.

## Safety notes

- `touch /.autorelabel` (or the `enforcing=0` + `restorecon` route) is not optional on an SELinux-enforcing system. Skipping it is the most common way this procedure fails - and the failure shows up as a login that refuses a password you know is correct.
- Never set `SELINUX=disabled` to get past a login that's failing after a reset. It hides the actual cause (a mislabeled `/etc/shadow`), and turning SELinux back on later requires its own full relabel anyway.
- Make sure console access works before you need it. On physical servers that means the iLO/iDRAC/IPMI login is known and tested; on cloud VMs it means the provider's serial console is enabled. Without a console, this procedure can't be done at all.
- Store the GRUB password like any other privileged credential. Without it, the next lost root password needs installation or rescue media to recover instead of a two-minute boot edit.
- A LUKS-encrypted root filesystem still asks for its passphrase before `rd.break` is reached - this procedure resets the root password, not disk encryption.
- In a real environment, a root password reset is a change like any other: get it approved, record when and why it was done, and rotate any credentials that may have been exposed by whatever caused the lockout.
- Remove `/root/shadow.lab-bak` from section 1 when the lab is finished - it's a copy of password hashes that has no reason to stay around.
