+++
title = "Serving the Local ISO Repository Over HTTP to an Offline Network"
date = 2026-10-28
description = "One RHEL 10 server with the install ISO mounted becomes the package source for every other machine on an air-gapped network: httpd serving /repo, the SELinux mount-context fix that restorecon can't do on a read-only ISO, a firewall opening, and client .repo files pointing at it over plain HTTP with GPG checking still doing the real security work."
tags = ["linux", "rhel", "dnf", "repositories", "httpd", "selinux", "sysadmin"]
+++

**Goal:** take the server from the [local ISO repository lab](/labs/local-repository-from-iso/) - the one with `/rhel10.iso` mounted on `/repo` - and make it the repository for every other RHEL 10 machine on the same isolated network, so none of them need their own copy of the ISO.

**Why this is the next step:** one ISO per server works for one server. On a real air-gapped network with ten or fifty machines, copying a 10G+ file onto each of them, and keeping fstab entries for it everywhere, doesn't scale. One repository server and a three-line `.repo` file on each client does. It also touches four RHCSA topics in one task - package installation, httpd, SELinux and firewalld - and each of them blocks the result on its own if skipped.

**Setup used throughout:** the repository server is `192.168.10.10`; clients are any other RHEL 10 machines on `192.168.10.0/24` with no internet access and no repositories configured. Commands are marked **server** or **client** in each section.

## 1. Server: confirm the starting point

```bash
findmnt /repo                  # mounted from /rhel10.iso, as set up in the previous lab
dnf repolist                     # repo_BaseOS and repo_AppStream, served locally via file://
```

Everything below builds on this - if `/repo` isn't mounted or the two local repositories aren't working yet, go through the [previous lab](/labs/local-repository-from-iso/) first.

## 2. Server: install and start httpd

```bash
sudo dnf install httpd             # comes from the local AppStream repo - no network needed
sudo systemctl enable --now httpd    # start now and on every boot
systemctl is-active httpd              # active
```

The web server that will hand packages to the rest of the network is itself installed from the same ISO - nothing in this lab ever needs anything outside the installation media.

## 3. Server: publish /repo through httpd

Rather than moving or copying the ISO contents into `/var/www/html`, point httpd at the existing mount point with an `Alias`:

```bash
sudo vim /etc/httpd/conf.d/repo.conf
```

```apache
Alias /repo /repo

<Directory /repo>
    Options Indexes FollowSymLinks
    Require all granted
</Directory>
```

```bash
sudo apachectl configtest         # Syntax OK - check before every restart
sudo systemctl restart httpd
curl -I http://localhost/repo/BaseOS/repodata/repomd.xml   # expected 200 - but it will be 403
```

`Alias` maps the URL path `/repo` to the directory `/repo`, and the `<Directory>` block is what actually allows httpd to serve files from outside `/var/www`. `Indexes` turns on directory listings, so `http://192.168.10.10/repo/` can be browsed like a file tree - convenient for a repository, and scoped to this one directory only.

The `403 Forbidden` is the expected result at this point. The config is correct; something else is refusing access.

## 4. Server: the SELinux part - and why restorecon can't fix it

```bash
ls -Zd /repo                                   # iso9660_t - not a type httpd is allowed to read
sudo ausearch -m AVC -ts recent | grep httpd    # the denial: httpd_t trying to read iso9660_t
```

Normally the fix for "httpd can't read this directory" is `semanage fcontext` + `restorecon`, as in the [SELinux lab](/labs/selinux-denied-troubleshooting/). That doesn't work here: an ISO 9660 filesystem is read-only and has no extended attributes at all, so there's nowhere to store a new label - every file on it gets one label, assigned when it's mounted. The fix therefore goes in the mount itself, via the `context=` mount option.

```bash
sudo cp /etc/fstab /etc/fstab.bak
sudo vim /etc/fstab
```

Change the existing `/repo` line from the previous lab to:

```text
/rhel10.iso  /repo  iso9660  defaults,context="system_u:object_r:httpd_sys_content_t:s0"  0 0
```

```bash
sudo systemctl daemon-reload
sudo umount /repo                  # context= only applies at mount time - a remount won't change it
sudo mount -a
ls -Zd /repo                         # httpd_sys_content_t now
curl -I http://localhost/repo/BaseOS/repodata/repomd.xml   # HTTP/1.1 200 OK
```

The server's own `dnf` keeps working with the new label - root and `dnf` aren't confined the way httpd is, so `file:///repo/...` reads the same as before.

The alternative is to copy the ISO contents into `/var/www/html/repo/`, where files inherit `httpd_sys_content_t` automatically. That also works, but it costs another 10G+ of disk for a second copy of the same packages, and the copy has to be redone by hand whenever the ISO is replaced. The mount option avoids both.

## 5. Server: open the firewall

```bash
sudo firewall-cmd --permanent --add-service=http   # port 80/tcp, in the default zone
sudo firewall-cmd --reload                           # --permanent changes only take effect after this
sudo firewall-cmd --list-services                      # http is now in the list
```

Until this step, `curl` against `localhost` succeeds while every client still times out - firewalld filters incoming traffic from other hosts, not loopback.

## 6. Client: test reachability before writing any config

```bash
curl -I http://192.168.10.10/repo/BaseOS/repodata/repomd.xml   # HTTP/1.1 200 OK from across the network
```

If this fails, no `.repo` file will fix it - a timeout points at the firewall (section 5), a `403` at SELinux or the `<Directory>` block (sections 3-4), and `Connection refused` at httpd not running.

## 7. Client: define both repositories

```bash
sudo vim /etc/yum.repos.d/local-http.repo
```

```ini
[local-http-BaseOS]
name=RHEL 10 BaseOS (repo server 192.168.10.10)
baseurl=http://192.168.10.10/repo/BaseOS
enabled=1
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-redhat-release

[local-http-AppStream]
name=RHEL 10 AppStream (repo server 192.168.10.10)
baseurl=http://192.168.10.10/repo/AppStream
enabled=1
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-redhat-release
```

One file can hold several repositories, each in its own `[section]`. Both still need to be defined, for the same reason as in the previous lab: BaseOS alone can't install anything from AppStream.

The GPG key comes from the client's own disk, not from the repository server. That's deliberate: the key is what proves the packages were signed by Red Hat, and fetching it from the same server that serves the packages would mean trusting that server to vouch for itself.

## 8. Client: install something

```bash
sudo dnf clean all                # no stale metadata from earlier attempts
dnf repolist                        # local-http-BaseOS and local-http-AppStream
sudo dnf install nmap                 # downloaded over HTTP, verified against the local key
```

## Verification - prove it survives a server reboot

```bash
# server
systemctl is-enabled httpd                       # enabled - starts on boot
sudo firewall-cmd --permanent --list-services      # http is in the permanent config, not just runtime
sudo umount /repo && sudo mount -a                   # stand-in for a reboot
ls -Zd /repo                                           # still httpd_sys_content_t - the label is in fstab
```

```bash
# client
sudo dnf --refresh install tcpdump                     # metadata re-downloaded from the server, package installed
dnf info tcpdump | grep -i repo                          # "From repo : local-http-AppStream"
```

Each of the four pieces - httpd running, the `/repo` mount, its SELinux label and the firewall rule - has a runtime state and a persistent one, and it's easy to fix only the runtime half. The checks above look at the persistent half of each, which is what's left after a real reboot.

## Safety notes

- Plain HTTP is acceptable here only because of `gpgcheck=1` on every client. HTTP itself proves nothing about where a package came from - GPG verification is the only thing stopping a tampered package from installing. Never combine an HTTP repository with `gpgcheck=0`.
- Keep the `<Directory>` block and `Indexes` scoped to `/repo` only. Turning on directory listings or `Require all granted` for a broader path exposes everything under it to the whole network.
- `--add-service=http` opens port 80 to anything that can reach the server's default zone. On a network that's more than one trusted segment, restrict it to the client subnet with a source-based zone or a rich rule instead.
- `context=` replaces the label for every file on that mount. That's the right choice for a read-only ISO that only httpd and `dnf` ever read, but don't reuse this approach for a writable filesystem - there, `semanage fcontext` + `restorecon` is the correct tool.
- Clients inherit everything from the previous lab's limitations: the repository is frozen at the ISO's release, with no security errata. Replacing the ISO on the server updates every client at once, which is the other real benefit of centralizing it.
- The same `/etc/fstab` warning still applies, now with higher stakes: if `/rhel10.iso` disappears, the server drops into emergency mode on its next boot and every client on the network loses its repository at the same time.
