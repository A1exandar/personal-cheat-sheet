+++
title = "Setting Up Repository Access From the Install ISO, Fully Offline"
date = 2026-10-22
description = "A RHEL 10 machine with no internet, no Red Hat CDN and no Satellite - turning the installation DVD into a persistent ISO file, loop-mounting it via /etc/fstab, and defining BaseOS and AppStream as local dnf repositories with GPG signature checking left on."
tags = ["linux", "rhel", "dnf", "repositories", "sysadmin"]
+++

**Goal:** on a RHEL 10 server with no internet access and no Red Hat Satellite to register against, get `dnf install` working again - using nothing but the installation DVD the system was built from, turned into two local repositories that survive a reboot.

**Why this comes up for real:** air-gapped networks (banking, government, isolated lab segments) routinely have servers that will never see `cdn.redhat.com`. The installation media already contains every package from the two base RHEL repositories, complete with signed metadata - it just isn't wired up as a repository by default. Doing that by hand, step by step, is also a standard RHCSA task, and every step below fails in a visible, specific way if skipped, which makes it a good one to actually understand rather than memorize.

## 1. Confirm the starting point - nothing to install from

```bash
dnf repolist                 # empty, or only repos that can't be reached
sudo dnf install nmap          # fails - there is no repository to resolve it from
```

On an unregistered system, `dnf` may also print a `subscription-manager` notice that the system isn't registered with an entitlement server. In this scenario that's expected and harmless - there is no entitlement server to register with, which is the whole point.

## 2. Find the installation media

```bash
lsblk                         # the DVD shows up as sr0, type rom
sudo blkid /dev/sr0             # TYPE="iso9660" and a LABEL like RHEL-10-0-BaseOS-x86_64
```

On a VM this is the ISO attached as a virtual CD/DVD drive; on physical hardware, the actual disc or a USB-attached optical drive.

## 3. Copy the disc into an ISO file on local disk

```bash
df -h /                                                 # the full DVD ISO needs well over 10G free - check first
sudo dd if=/dev/sr0 of=/rhel10.iso bs=10M status=progress   # raw byte-for-byte copy of the whole disc
ls -lh /rhel10.iso                                        # size should match the original ISO, not a few MB
```

Copying the disc instead of mounting `/dev/sr0` directly is the step that makes the rest of this lab durable. A virtual DVD gets detached, a physical one gets ejected or borrowed - and a repository pointing at a drive that's suddenly empty breaks every `dnf` command on the system. A file on local disk stays put.

`bs=10M` just reads in larger chunks than the 512-byte default, which is dramatically faster for a multi-gigabyte copy; it has no effect on the result.

## 4. Mount the ISO persistently via /etc/fstab

```bash
sudo mkdir /repo
sudo cp /etc/fstab /etc/fstab.bak                                     # one-command undo if the edit goes wrong
echo "/rhel10.iso  /repo  iso9660  defaults  0 0" | sudo tee -a /etc/fstab
sudo systemctl daemon-reload                                            # systemd generates mount units from fstab - refresh them
sudo mount -a                                                             # test the new entry now, not at the next boot
```

```bash
findmnt /repo                  # SOURCE is a /dev/loopN device backed by /rhel10.iso
ls /repo                         # BaseOS, AppStream, EFI, images, media.repo, RPM-GPG-KEY-redhat-* ...
ls /repo/BaseOS                    # Packages/ and repodata/
```

There's no explicit `loop` option in the fstab entry, and none is needed - when the source is a regular file instead of a block device, `mount` sets up a loop device on its own. An `iso9660` filesystem is read-only by nature, so it always mounts read-only regardless of `defaults`.

The `repodata/` directory is what actually makes a folder a repository: it's the signed metadata `dnf` reads to know which packages exist and what they depend on. `Packages/` alone is just a pile of RPM files.

## 5. Notice that mounting alone changes nothing

```bash
sudo dnf install nmap          # still fails exactly as in section 1
```

`dnf` never scans the filesystem looking for packages - it only knows about repositories defined in `/etc/yum.repos.d/`. The packages are now sitting on disk, but until a repository definition points at them, they don't exist as far as `dnf` is concerned.

## 6. Add BaseOS as a repository - and fix GPG checking

```bash
sudo dnf config-manager --add-repo="file:///repo/BaseOS"   # writes /etc/yum.repos.d/repo_BaseOS.repo
cat /etc/yum.repos.d/repo_BaseOS.repo                        # see exactly what it generated
```

The generated file is minimal - a section name, a placeholder `name=`, the `baseurl=` and `enabled=1`. What it doesn't contain is any GPG key, and `gpgcheck=1` is the global default in `/etc/dnf/dnf.conf` on RHEL, so the first real install from it would fail with `Public key for ... is not installed`. Edit the file:

```bash
sudo vim /etc/yum.repos.d/repo_BaseOS.repo
```

```ini
[repo_BaseOS]
name=RHEL 10 BaseOS (local ISO)
baseurl=file:///repo/BaseOS
enabled=1
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-redhat-release
```

The Red Hat release key is already on every installed RHEL system at that path - it doesn't need to come from the network. Setting `gpgcheck=0` instead also makes the error go away, but it means `dnf` will install anything placed in that directory without verifying who built it; keep the check on and point it at the real key.

## 7. Add AppStream the same way

```bash
sudo dnf install nmap          # still "No match for argument: nmap" - with only BaseOS defined
```

RHEL splits its packages across two repositories: **BaseOS** holds the core operating system, **AppStream** holds the applications, languages and tools on top of it - `nmap` among them. A single repo pointing at BaseOS is the most common half-done version of this task.

```bash
sudo dnf config-manager --add-repo="file:///repo/AppStream"
sudo vim /etc/yum.repos.d/repo_AppStream.repo
```

```ini
[repo_AppStream]
name=RHEL 10 AppStream (local ISO)
baseurl=file:///repo/AppStream
enabled=1
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-redhat-release
```

`dnf config-manager` is only a convenience - writing both `.repo` files directly in an editor produces exactly the same result, and on an exam or a system without `dnf-plugins-core` installed, that's the version to know by heart.

## 8. Install something

```bash
sudo dnf clean all             # drop any cached metadata from earlier failed attempts
dnf repolist                     # repo_BaseOS and repo_AppStream, both enabled
sudo dnf install nmap              # resolves, verifies the signature, installs
```

## Verification - prove it survives a reboot, not just this session

```bash
rpm -q nmap                                   # installed
dnf info nmap | grep -i repo                    # "From repo : repo_AppStream" - came from the local ISO
sudo umount /repo                                 # simulate a fresh boot: repository source gone
sudo mount -a                                         # fstab brings it back with no manual steps
findmnt /repo                                           # mounted again, from /rhel10.iso
sudo dnf --refresh install tcpdump                        # a second package, with metadata re-read from the mounted ISO
```

The real test is a reboot followed by a `dnf install` with no manual mounting in between - `umount` + `mount -a` is the fast stand-in for it, the same trick used for `/etc/fstab` in the [LVM lab](/labs/lvm-from-scratch/).

## Safety notes

- An ISO-backed `/etc/fstab` entry depends on a plain file. If `/rhel10.iso` is ever deleted or moved, the next boot drops into emergency mode waiting for a mount that can't succeed - add `nofail` to the options (`defaults,nofail`) if the repository isn't critical to booting, and never delete the ISO without removing its fstab line first.
- Keep `/etc/fstab.bak` until the system has actually rebooted cleanly at least once with the new entry - it's the fastest recovery from the emergency shell if anything went wrong.
- Don't solve the GPG error with `gpgcheck=0`. It works, but it silently removes the only check that the packages being installed are the ones Red Hat signed - point `gpgkey=` at `/etc/pki/rpm-gpg/RPM-GPG-KEY-redhat-release` instead.
- A local ISO repository is frozen at the release it was cut from: no security errata, ever. For a long-lived air-gapped system, plan a way to bring in updated media or a synced mirror - this setup gets a server installable, not patched.
- Only ever point `baseurl=` at media from the exact same major release (RHEL 10 ISO for a RHEL 10 system) - mixing releases produces dependency conflicts that look like a broken system rather than a wrong repository.
- See the [package management cheat sheet](/sheets/package-management-cheat-sheet/#adding-a-repository) for adding repositories on a system that does have network access.
