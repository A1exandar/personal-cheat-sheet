+++
title = "Running a Rootless Podman Container as a systemd Service with Quadlet"
date = 2026-11-02
description = "A static website in a rootless nginx container, run by a regular user and managed by systemd through a Quadlet .container file: why su - breaks systemctl --user, why the unit can't be enabled, an image that exits silently without Exec=, loginctl enable-linger for starting at boot without a login, Restart=on-failure, and the rootless limits - port 80, SELinux :Z and subuid mapping."
tags = ["linux", "rhel", "podman", "containers", "systemd", "rhcsa", "sysadmin"]
+++

**Goal:** run a small static website in a container as the regular user `alex`, not as root, and have systemd start it at boot, restart it if it crashes, and keep it running when nobody is logged in.

**Why Quadlet:** a container started with `podman run -d` is just a process. Nothing starts it again after a reboot or a crash. Quadlet lets you describe the container in a short `.container` file, and systemd turns it into a normal service at every `daemon-reload`. The older way, `podman generate systemd`, is deprecated - section 9 shows what it prints now. Running it rootless means that a compromised container gets the permissions of an unprivileged user on the host, not root's.

**Tested on:** a Fedora VM with Podman 6.0 and systemd 259, SELinux enforcing, using the `registry.access.redhat.com/ubi10/nginx-126` image. RHEL 10 ships Podman 5.x, where everything below works the same way. Every command and output in the code blocks comes from that run, except the `firewall-cmd` step, because the test VM had no firewalld. Alternatives mentioned only in passing, like the sysctl in section 8, weren't part of the run. UIDs and the subuid range will differ on another system.

## 1. A regular user for the service

```bash
sudo useradd alex
sudo passwd alex
grep alex /etc/subuid /etc/subgid
```

```text
/etc/subuid:alex:1100000:65536
/etc/subgid:alex:1100000:65536
```

These two lines are what makes rootless containers possible. `useradd` adds them automatically: `alex` gets 65536 extra UIDs and GIDs, starting at 1100000, to use inside containers. A user created without them - for example, one that comes from LDAP - can't run rootless containers, and podman complains about missing subuid ranges. Add the range by hand with `sudo usermod --add-subuids 1100000-1165535 --add-subgids 1100000-1165535 alex`.

## 2. Log in as that user - properly

Everything from here until section 6 runs as `alex`. The usual way of switching users doesn't work for this:

```bash
sudo su - alex
systemctl --user status
```

```text
Failed to connect to user scope bus via local transport: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined
```

`su` changes the user but doesn't create a login session, so `alex` has no systemd user manager and no `/run/user/<uid>` directory. `podman` itself also prints warnings about falling back to `cgroupfs`. Log in in a way that creates a real session instead:

```bash
ssh alex@localhost
# or, with the systemd-container package installed:
sudo machinectl shell alex@
```

```bash
echo $XDG_RUNTIME_DIR                 # /run/user/1000
systemctl --user is-system-running    # running
```

## 3. Run the container by hand first

Before writing any unit, make sure the container itself works:

```bash
mkdir -p ~/site
echo '<h1>Hello from a rootless container</h1>' > ~/site/index.html

podman run -d --name web -p 8080:8080 \
    -v ~/site:/opt/app-root/src:Z \
    registry.access.redhat.com/ubi10/nginx-126 nginx -g 'daemon off;'

curl -s localhost:8080
podman ps
```

```text
<h1>Hello from a rootless container</h1>
CONTAINER ID  IMAGE                                              COMMAND               CREATED        STATUS        PORTS                             NAMES
b8878a07d199  registry.access.redhat.com/ubi10/nginx-126:latest  nginx -g daemon o...  3 seconds ago  Up 3 seconds  0.0.0.0:8080->8080/tcp, 8443/tcp  web
```

- `-p 8080:8080` - the image's nginx listens on 8080. Port 80 isn't an option for a rootless container anyway - see section 8.
- `:Z` on the volume - relabels `~/site` for SELinux so the container can read it. Section 8 shows what happens without it.
- `nginx -g 'daemon off;'` at the end is required. Section 4 explains why.

It works, so remove it. From now on, systemd creates the container:

```bash
podman rm -f web
```

## 4. Write the Quadlet file

Quadlet reads user `.container` files from `~/.config/containers/systemd/`:

```bash
mkdir -p ~/.config/containers/systemd
vim ~/.config/containers/systemd/web.container
```

```ini
[Unit]
Description=Static website (rootless nginx)

[Container]
ContainerName=web
Image=registry.access.redhat.com/ubi10/nginx-126
Exec=nginx -g "daemon off;"
PublishPort=8080:8080
Volume=%h/site:/opt/app-root/src:Z

[Service]
Restart=on-failure

[Install]
WantedBy=default.target
```

- `[Container]` is the part Quadlet translates into a `podman run` command. Each key matches a `podman run` option from section 3.
- `%h` is the user's home directory. `~` doesn't work in unit files.
- `Image=` uses the full registry path. A short name like `nginx` depends on the system's short-name aliases and registry list, so it can resolve to a different image on another host.
- `[Service]` and `[Install]` are passed through to the generated unit unchanged.
- `WantedBy=default.target` - for a user service, this means "start it when this user's systemd manager starts".

**Without `Exec=`, the service starts and then quietly dies.** This image is a Red Hat S2I builder image. Its default command only prints usage instructions and exits with code `0`. In the first version of this file, without `Exec=`, `systemctl --user start` returned no error, but the status showed:

```text
○ web.service - Static website (rootless nginx)
     Active: inactive (dead) since Mon 2026-11-02 10:24:46 CET; 2s ago
   Duration: 34ms
   Main PID: 3019 (code=exited, status=0/SUCCESS)
```

The journal showed the image's help text (`This is a S2I rhel base image...`). The exit code was `0`, so `Restart=on-failure` didn't do anything either. When a container service is `inactive (dead)` right after starting, check what the image's default command does with `podman inspect --format '{{.Config.Cmd}}' <image>`.

## 5. Load and start the service

```bash
systemctl --user daemon-reload
systemctl --user start web.service
systemctl --user status web.service
curl -s localhost:8080
```

```text
● web.service - Static website (rootless nginx)
     Loaded: loaded (/var/home/alex/.config/containers/systemd/web.container; generated)
     Active: active (running) since Mon 2026-11-02 10:25:43 CET; 3s ago
   Main PID: 3822 (conmon)
     CGroup: /user.slice/user-1000.slice/user@1000.service/app.slice/web.service
             ├─libpod-payload-53a33a6e5e0b...
             │ ├─3824 "nginx: master process nginx -g daemon off;"
             │ ├─3828 "nginx: worker process"
<h1>Hello from a rootless container</h1>
```

`daemon-reload` is what runs Quadlet: it reads `web.container` and generates `web.service`. `Loaded:` shows the `.container` file as the source and `generated`. Run `daemon-reload` again after every change to the `.container` file. Without it, `systemctl` keeps using the old version and only prints a warning:

```text
Warning: The unit file, source configuration file or drop-ins of web.service changed on disk. Run 'systemctl --user daemon-reload' to reload units.
```

If the service doesn't appear at all after `daemon-reload`, Quadlet most likely rejected the file. To see the unit it generates, or the error, run it by hand:

```bash
/usr/libexec/podman/quadlet --dryrun --user
```

```text
---web.service---
...
ExecStart=/usr/bin/podman run --name web --replace --rm --cgroups=split --sdnotify=conmon -d -v %h/site:/opt/app-root/src:Z --publish 8080:8080 registry.access.redhat.com/ubi10/nginx-126 nginx -g "daemon\x20off;"
```

**Don't run `systemctl --user enable web.service`.** It fails:

```text
Failed to enable unit: Unit /run/user/1000/systemd/generator/web.service is transient or generated
```

A generated unit can't be enabled. The `[Install]` section in the `.container` file does the same job: Quadlet links the service into `default.target` itself at every `daemon-reload`.

## 6. Keep it running without a login - linger

So far, the service runs only while `alex` is logged in. A user's systemd manager starts at their first login and stops a few seconds after their last logout, together with everything it runs. After logging out of the session from section 2:

```bash
curl -s -m3 localhost:8080 || echo "curl failed"
```

```text
curl failed
```

The container is gone. For the user manager to start at boot and keep running with no session, enable lingering. Run this as root:

```bash
sudo loginctl enable-linger alex
loginctl show-user alex -p Linger
curl -s localhost:8080
```

```text
Linger=yes
<h1>Hello from a rootless container</h1>
```

Enabling linger starts the user manager immediately. The user manager starts `default.target`, and `default.target` starts `web.service` - there's no need to log in again. The setting is stored as an empty file in `/var/lib/systemd/linger/alex`. It survives reboots.

## 7. Restart on failure - and what doesn't count as a failure

`Restart=on-failure` restarts the service when the container exits with an error. Simulate a crash:

```bash
podman kill web
sleep 5
systemctl --user status web.service | grep Active
journalctl --user -u web.service -o cat | tail -3
```

```text
     Active: active (running) since Mon 2026-11-02 10:25:58 CET; 4s ago
web.service: Main process exited, code=exited, status=137/n/a
web.service: Failed with result 'exit-code'.
web.service: Scheduled restart job, restart counter is at 1.
```

Exit code `137` means the process was killed with SIGKILL (128 + 9), so it counts as a failure, and systemd restarted the service. `podman stop web` is different: nginx shuts down cleanly, systemd sees a normal exit, and the service stays `inactive`. Stop and start the container through `systemctl --user` instead of `podman`, so systemd always knows what you meant.

## 8. Rootless limits - ports, SELinux, file ownership

**Ports below 1024.** A regular user can't listen on them:

```bash
podman run --rm -d -p 80:8080 registry.access.redhat.com/ubi10/nginx-126 nginx -g 'daemon off;'
```

```text
Error: pasta failed with exit code 1:
Listen failed for HOST TCP port */80: Permission denied
```

The limit is the `net.ipv4.ip_unprivileged_port_start` sysctl, which is `1024` by default. Either keep the service on 8080 and put a reverse proxy running as root in front of it on port 80, or lower the limit for the whole system: `sudo sysctl -w net.ipv4.ip_unprivileged_port_start=80`, plus a file in `/etc/sysctl.d/` to keep the setting. Lowering the limit lets every user on the system bind ports 80 and up, not only `alex`.

**SELinux and `:Z`.** The same container with the volume mounted without `:Z`:

```bash
podman run -d --name noz -p 8081:8080 -v ~/site2:/opt/app-root/src registry.access.redhat.com/ubi10/nginx-126 nginx -g 'daemon off;'
curl -s -o /dev/null -w '%{http_code}\n' localhost:8081
podman exec noz ls /opt/app-root/src
ls -dZ ~/site ~/site2
```

```text
403
ls: cannot open directory '/opt/app-root/src': Permission denied
system_u:object_r:container_file_t:s0:c372,c448 /var/home/alex/site
           unconfined_u:object_r:user_home_t:s0 /var/home/alex/site2
```

The Unix permissions are fine. SELinux blocks the container from reading files labeled `user_home_t`. `:Z` relabels the directory as `container_file_t` with categories (`c372,c448`) that only this container gets. Use lowercase `:z` instead when two containers have to share the same directory. Never use `:Z` on a system directory like `/home` or `/etc` - it relabels everything underneath for one container.

**Who the processes really are.** Inside the container, nginx runs as the image's user `default`, UID 1001. On the host, it's neither `alex` nor root:

```bash
podman top web user huser
```

```text
USER        HUSER
default     1101000
default     1101000
default     1101000
```

UID 0 in the container maps to `alex` itself, and UIDs from 1 upward map into the subuid range from section 1. So 1001 inside becomes 1100000 + 1000 = 1101000 outside. A file the container creates in a volume belongs to UID 1101000 on the host, and `alex` can't change or delete it with a plain `chown` or `rm`. Run the command inside the user namespace instead: `podman unshare chown -R 0:0 ~/site` or `podman unshare rm <file>`.

## 9. The old way - `podman generate systemd`

Many older guides use this command to turn an existing container into a unit file:

```bash
podman generate systemd --new --name web
```

```text
DEPRECATED command:
It is recommended to use Quadlets for running containers and pods under systemd.
```

It still works, but it gets no new features. The unit file it writes is a snapshot of one `podman run`, and changing it means editing a long `ExecStart=` line by hand. A Quadlet file stays short, reads like configuration, and is regenerated at every `daemon-reload`. For existing units created with `generate systemd`, rewrite them as `.container` files.

## Verification - prove it survives a reboot

First open the port in the firewall so other machines can reach it:

```bash
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --reload
```

Then reboot and don't log in as `alex`:

```bash
sudo reboot
```

From any other account, or another machine (use the server's IP address instead of `localhost`):

```bash
curl -s localhost:8080                          # <h1>Hello from a rootless container</h1>
ps -o user,pid,cmd -u 1101000                   # nginx master + worker, as 1101000
loginctl list-users                             # alex ... LINGER yes, STATE lingering
```

```text
<h1>Hello from a rootless container</h1>
USER         PID CMD
1101000     1221 nginx: master process nginx -g daemon off;
1101000     1237 nginx: worker process
1000 alex yes lingering
```

`lingering` means the user manager is running with no login session - exactly what a service account needs. If the site doesn't respond, log in as `alex` as in section 2 and check `systemctl --user status web.service` and `journalctl --user -u web.service`.

## Safety notes

- Don't use `su - alex` or `sudo -u alex` to manage user services. There's no session, so `systemctl --user` fails and podman falls back to `cgroupfs`. Log in with `ssh` or `machinectl shell`.
- Without `loginctl enable-linger`, every rootless service stops when its user logs out, and nothing starts it at boot. It's the most common reason a rootless container "works until the next reboot".
- Run `systemctl --user daemon-reload` after every edit to a `.container` file. Then check `systemctl --user status` - a service that's `inactive (dead)` right after a "successful" start usually means the image's default command exits.
- Use `:Z` only on directories that belong to this one container. Relabeling a shared or system directory can break other services that read it.
- Files written by the container into a volume belong to subuids on the host. Use `podman unshare` to change or remove them, instead of reaching for root.
- Rootless doesn't mean unrestricted. `alex` can't bind ports below 1024, can't use more UIDs than its subuid range, and its containers stop with its user manager. That's the point - a compromised container gets the privileges of `alex`, not root.
