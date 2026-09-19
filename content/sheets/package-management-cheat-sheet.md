+++
title = "Package Management (apt/dnf) Cheat Sheet"
date = 2026-09-19
description = "Install, update, remove and search for packages on Debian/Ubuntu (apt) and RHEL/Fedora (dnf), side by side."
tags = ["linux", "apt", "dnf", "sysadmin"]
+++

A side-by-side reference for the two package managers you'll meet most often: `apt` on Debian/Ubuntu, and `dnf` on Fedora/RHEL/Rocky/Alma. Same job, different commands — this sheet lines them up so you stop guessing which one a given server needs.

## Update the package index

```bash
sudo apt update      # refresh the list of available packages and versions
```
```bash
sudo dnf check-update # same idea - dnf refreshes its cache automatically on most commands
```
`apt update` only refreshes metadata — it does not install anything yet. `dnf` refreshes its cache as needed on its own, so `check-update` is mostly for seeing what's pending.

## Upgrade installed packages

```bash
sudo apt upgrade          # upgrade all packages to their newest available version
sudo apt full-upgrade     # like upgrade, but also allowed to remove packages if a dependency requires it
```
```bash
sudo dnf upgrade          # upgrade all packages (dnf's equivalent of full-upgrade)
```
> Run `apt update` (or let `dnf` refresh) before upgrading, and read what's about to change — `full-upgrade`/`dnf upgrade` can remove packages, which matters on a production server.

## Install a package

```bash
sudo apt install nginx        # install nginx, plus anything it depends on
sudo apt install nginx=1.24.0-1  # install a specific version, if available in the repo
```
```bash
sudo dnf install nginx        # same idea on Fedora/RHEL
sudo dnf install nginx-1.24.0 # specific version syntax varies by package
```

## Remove a package

```bash
sudo apt remove nginx     # remove the package, keep its config files in /etc
sudo apt purge nginx      # remove the package AND its config files
```
```bash
sudo dnf remove nginx     # removes the package (dnf doesn't separate remove/purge the same way)
```
> `purge` deletes configuration too — only reach for it when you actually want a clean slate, not just to free disk space.

## Search for a package

```bash
apt search nginx          # search package names and descriptions
apt show nginx            # full details: version, dependencies, description
```
```bash
dnf search nginx          # same idea
dnf info nginx            # full details, dnf's equivalent of apt show
```

## List installed packages

```bash
apt list --installed              # every installed package
apt list --installed | grep nginx # narrow it down to one
dpkg -l | grep nginx              # lower-level alternative, works even if apt itself is broken
```
```bash
dnf list installed                # every installed package
dnf list installed | grep nginx   # narrow it down
rpm -qa | grep nginx              # low-level alternative, dnf's equivalent of dpkg -l
```

## Find which package owns a file

```bash
dpkg -S /usr/sbin/nginx    # "which package put this file here?"
```
```bash
rpm -qf /usr/sbin/nginx    # same question, RPM-based systems
```
Useful when you find a binary or config file and don't know what installed it — common during troubleshooting or auditing an unfamiliar server.

## Clean up disk space

```bash
sudo apt autoremove   # remove packages that were auto-installed as dependencies and are no longer needed
sudo apt autoclean    # delete cached .deb files for packages no longer installed
sudo apt clean        # delete ALL cached .deb files, even for currently installed packages
```
```bash
sudo dnf autoremove   # same idea - drop orphaned dependencies
sudo dnf clean all    # clear dnf's cached metadata and packages
```

## Adding a repository

```bash
sudo add-apt-repository ppa:ondrej/php   # add a third-party PPA (Ubuntu)
sudo apt update                          # refresh the index so the new repo's packages show up
```
```bash
sudo dnf install epel-release   # enable the EPEL repo (common extra repo on RHEL/Rocky/Alma)
sudo dnf config-manager --add-repo <url>  # add an arbitrary .repo URL
```
> Only add repositories you trust — a repo can serve arbitrary, unsigned-by-default software with root install privileges. Prefer well-known, actively maintained sources.

## Holding a package at its current version

```bash
sudo apt-mark hold nginx     # prevent nginx from being upgraded by future `apt upgrade` runs
sudo apt-mark unhold nginx   # allow it to be upgraded again
```
```bash
sudo dnf versionlock add nginx     # equivalent on dnf (needs the versionlock plugin installed)
sudo dnf versionlock delete nginx  # remove the lock
```
Useful when a newer version breaks something you depend on and you need to stay on a known-good release temporarily — remember to actually go back and upgrade later once it's fixed.

## Quick reference table

| Task | apt (Debian/Ubuntu) | dnf (Fedora/RHEL family) |
|---|---|---|
| Refresh index | `apt update` | `dnf check-update` |
| Upgrade all | `apt full-upgrade` | `dnf upgrade` |
| Install | `apt install <pkg>` | `dnf install <pkg>` |
| Remove | `apt purge <pkg>` | `dnf remove <pkg>` |
| Search | `apt search <term>` | `dnf search <term>` |
| Package info | `apt show <pkg>` | `dnf info <pkg>` |
| List installed | `dpkg -l` | `rpm -qa` |
| Who owns this file | `dpkg -S <path>` | `rpm -qf <path>` |
| Clean cache | `apt clean` | `dnf clean all` |

## Safety notes

- Always run an update/refresh before installing or upgrading, so you're working from current package information.
- Read what a command is about to remove before confirming, especially `full-upgrade`/`dnf upgrade` and anything involving `purge`.
- Only add third-party repositories you trust — they run with the same root privileges as your official ones.
- On a production server, test package upgrades on a staging box first where possible; a routine upgrade can still change a config file's default or a service's behavior.
