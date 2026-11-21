+++
title = "Ansible on RHEL 10: Rootless Containers as systemd Services"
date = 2026-11-21
description = "The sixth lab in the Ansible series: one playbook runs a rootless nginx container as a systemd service on both servers, using the RHEL podman system role and a Quadlet spec. It starts at boot without a login and opens its port in the firewall. Includes a missing acl package that stops Ansible from becoming the container user, a role error hidden by no_log, a container that stayed down after a clean exit, a changed port that the firewall still blocked, and systemctl --user failing over Ansible."
tags = ["linux", "rhel", "ansible", "automation", "podman", "containers", "systemd", "quadlet", "sysadmin"]
+++

**Goal:** the same rootless web container on `server1` and `server2`, kept in one playbook:

- a regular user `webapp` runs an nginx container, not root
- the site is served from `~webapp/site` on the host, so the content survives a new container
- the container runs as a systemd service and starts at boot, with nobody logged in
- it comes back if it stops on its own
- port `8080` is open in the firewall

This is the "containers as services" task from my RHCSA practice exercises. The manual version, with every step explained, is in [rootless Podman container as a systemd service](/labs/podman-rootless-quadlet-service/). This lab does the same with Ansible.

**Starting point:** the setup from the earlier labs in this series: `server1` is the control node, the project is in `~/ansible`, and both servers install packages from the ISO repositories. The servers also need to reach `registry.access.redhat.com` to pull the image.

**Lab environment:**

| Host | IP address | Role |
|---|---|---|
| `server1` | `192.168.10.10` | control node + managed node |
| `server2` | `192.168.10.11` | managed node |

The addresses are examples. Replace them with your own.

**Tested on:** CentOS Stream 10 containers with systemd (`ansible-core 2.16`, `rhel-system-roles 2.4`, Podman 5). Every output below comes from that test. Restarting the `server2` container counted as the reboot test.

## 1. Which tool for what

| Task | Tool | Offline? |
|---|---|---|
| user, site directory, start page | `ansible.builtin` modules | yes |
| image, Quadlet file, user service, linger | `redhat.rhel_system_roles.podman` | yes (`rhel-system-roles` from the ISO) |
| firewall port | the same role, through `podman_firewall` | yes |

The `containers.podman` collection isn't part of `ansible-core`. The podman system role ships with `rhel-system-roles`, which you installed in [lab 2](/labs/ansible-offline-repositories/), and it does all the rootless work: it writes the Quadlet file into the user's home, enables linger, reloads the user's systemd and starts the service.

## 2. The playbook

```bash
cd ~/ansible
vim containers.yml
```

```yaml
---
- name: Rootless web container as a service
  hosts: servers
  become: true
  vars:
    web_user: webapp
    web_port: 8080
    podman_run_as_user: "{{ web_user }}"
    podman_firewall:
      - port: "{{ web_port }}/tcp"
        state: enabled
    podman_quadlet_specs:
      - name: web
        type: container
        Unit:
          Description: Static website in a rootless nginx container
        Container:
          Image: registry.access.redhat.com/ubi10/nginx-126
          ContainerName: web
          Exec: nginx -g "daemon off;"
          PublishPort: "{{ web_port }}:8080"
          Volume: "%h/site:/opt/app-root/src:Z"
        Service:
          Restart: always
        Install:
          WantedBy: default.target
  pre_tasks:
    - name: acl is installed
      ansible.builtin.dnf:
        name: acl
        state: present

    - name: Service user exists
      ansible.builtin.user:
        name: "{{ web_user }}"
        comment: Rootless web container

    - name: Site directory exists
      ansible.builtin.file:
        path: "/home/{{ web_user }}/site"
        state: directory
        owner: "{{ web_user }}"
        group: "{{ web_user }}"
        mode: "0755"

    - name: Start page
      ansible.builtin.copy:
        dest: "/home/{{ web_user }}/site/index.html"
        content: |
          <h1>{{ inventory_hostname }}</h1>
        owner: "{{ web_user }}"
        group: "{{ web_user }}"
        mode: "0644"
  roles:
    - redhat.rhel_system_roles.podman
```

How to read it:

- **`podman_run_as_user`** makes every container in the play rootless, owned by `webapp`. The role doesn't create the user. That's why the user is created in `pre_tasks`, which run **before** the role. `user` also adds `webapp` to `/etc/subuid` and `/etc/subgid`, which rootless Podman needs. The role stops with an error if the user isn't there.
- **`podman_quadlet_specs`** is the `.container` file from the manual lab, written as YAML. Each section (`Unit`, `Container`, `Service`, `Install`) becomes a `[Section]` in the file, and each key becomes a line. Section 3 shows the file it produced.
- **`Exec:`** is needed with this image. It's a Red Hat S2I image, and its default command only prints usage and exits. The manual lab shows that failure.
- **`%h`** in `Volume:` is systemd for the user's home directory. `:Z` relabels the directory for SELinux, so the container may read it.
- **`web_port`** is used for both the container port and the firewall. Section 6 shows why it's a variable.
- **`acl`** is needed for Ansible to become `webapp`. Section 4 shows what happens without it.

## 3. Run it

```bash
ansible-playbook --syntax-check containers.yml
ansible-playbook containers.yml
```

The role has more than 150 tasks, most of them skipped. The first run takes a few minutes, mostly for installing Podman and firewalld and pulling the image. These are the tasks that changed something:

```
TASK [acl is installed] ********************************************************
changed: [server2]
changed: [server1]

TASK [redhat.rhel_system_roles.podman : Ensure container images are present] ***
changed: [server2]
changed: [server1]

TASK [redhat.rhel_system_roles.podman : Ensure the quadlet directory is present] ***
changed: [server2]
changed: [server1]

TASK [redhat.rhel_system_roles.podman : Ensure quadlet file is present] ********
changed: [server2]
changed: [server1]

TASK [redhat.rhel_system_roles.podman : Start service] *************************
changed: [server1]
changed: [server2]

PLAY RECAP *********************************************************************
server1  : ok=84   changed=5    unreachable=0    failed=0    skipped=75 ...
server2  : ok=84   changed=5    unreachable=0    failed=0    skipped=75 ...
```

The second run took 15 seconds:

```
PLAY RECAP *********************************************************************
server1  : ok=82   changed=0    unreachable=0    failed=0    skipped=77 ...
server2  : ok=82   changed=0    unreachable=0    failed=0    skipped=77 ...
```

Both sites answer from `server1`:

```bash
curl server1:8080
curl server2:8080
```

```
<h1>server1</h1>
<h1>server2</h1>
```

The file the role wrote on `server2`:

```bash
ansible server2 -b -a "cat /home/webapp/.config/containers/systemd/web.container"
```

```ini
#
# Ansible managed
#
# system_role:podman

[Unit]
Description=Static website in a rootless nginx container
[Container]
Image=registry.access.redhat.com/ubi10/nginx-126
ContainerName=web
Exec=nginx -g "daemon off;"
PublishPort=8080:8080
Volume=%h/site:/opt/app-root/src:Z
[Service]
Restart=always
[Install]
WantedBy=default.target
```

It's the same file you'd write by hand, in the place where Quadlet looks for a user's containers. The role also enabled linger:

```bash
ansible server2 -a "loginctl list-users"
```

```
 UID USER    LINGER STATE
1000 ansible no     active
1001 webapp  yes    lingering
```

`lingering` means `webapp`'s systemd runs with nobody logged in, starts at boot and starts `web.service` with it. After a restart of `server2`, the site answered again without anyone logging in.

## 4. Ansible couldn't become webapp

The first version of the playbook had no `acl` task. It stopped at the image pull, with no reason given:

```
TASK [redhat.rhel_system_roles.podman : Ensure container images are present] ***
fatal: [server1]: FAILED! => {"censored": "the output has been hidden due to the fact that 'no_log: true' was specified for this result"}
```

The role hides the output of some tasks, because they can contain registry passwords. To see the real error, turn that off for one run:

```bash
ansible-playbook containers.yml -l server2 -e podman_secure_logging=false
```

```
"msg": "Failed to set permissions on the temporary files Ansible needs to create when becoming an unprivileged user (rc: 1, err: chmod: invalid mode: ‘A+user:webapp:rx:allow’ ...
```

Ansible copies each module to a temporary file as the `ansible` user and runs it as `webapp`. For `webapp` to read a file owned by `ansible`, Ansible gives `webapp` access with `setfacl`, which comes from the `acl` package. Without `acl` it tries other methods, and they all fail. The role runs `podman pull` as `webapp`, so this is the first task that needs it.

[Lab 4](/labs/ansible-users-groups-vault/) installs `acl` for the shared directory, so if you ran it, you won't see this error. The task stays in this playbook so that it works on a fresh server too.

## 5. The container that stayed down

The first version used `Restart: on-failure`, as in the manual lab. To test it, I stopped nginx inside the container the normal way, with SIGTERM:

```bash
ansible server2 -b -a 'pkill -f "nginx: master"'
ansible server2 -b -a "systemctl --user -M webapp@ status web.service --no-pager"
```

```
     Active: inactive (dead) since Sat 2026-11-21 08:26:42 UTC; 8s ago
```

The site was down and systemd didn't restart it. nginx exits with code `0` on SIGTERM, so for systemd the service ended successfully, and `on-failure` only restarts after an error. With `kill -9` the container came back, because exit code `137` counts as a failure.

With `Restart: always`, the clean stop came back after a few seconds too. `systemctl --user stop web.service` still stops it for good: a stop that you ask for is never restarted.

When the Quadlet spec changes, the role rewrites the file and restarts the service itself. That's the `Restart service` task in the output, so there's no need for a handler here.

## 6. The new port the firewall blocked

The first version had `8080` typed in twice: in `PublishPort` and in `podman_firewall`. I changed only `PublishPort` to `8081`:

```bash
curl -m 5 server2:8081
echo $?
```

```
7
```

```bash
ansible server2 -a "curl -s localhost:8081"
```

```
<h1>server2</h1>
```

The container listened on `8081`, but the firewall still allowed only `8080`. From `server2` itself it worked, so the container wasn't the problem. The `web_port` variable now sets both values, and it can be changed from the command line:

```bash
ansible-playbook containers.yml -l server2 -e web_port=8081
```

When I changed back to `8080`, `8081` stayed open:

```
8080/tcp 8081/tcp
```

The role only opens the ports in the current list. It doesn't know which ports an earlier run opened. To close the old one, add it with `state: disabled`, run the playbook once, then remove the line:

```yaml
    podman_firewall:
      - port: "{{ web_port }}/tcp"
        state: enabled
      - port: 8081/tcp
        state: disabled
```

It's the same as the renamed cron job in [lab 5](/labs/ansible-scheduling-cron-timers/): removing something from the playbook doesn't remove it from the server.

## 7. systemctl --user over Ansible

To check the service as `webapp`, the obvious command is `become_user` with `systemctl --user`:

```bash
ansible server2 -b --become-user webapp -a "systemctl --user status web.service"
```

```
Failed to connect to user scope bus via local transport: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined (consider using --machine=<user>@.host --user to connect to bus of other user)
```

It's the same reason `su -` breaks `systemctl --user` in the manual lab: switching users doesn't give you a login session. The error message already suggests the fix: ask as root for `webapp`'s systemd with `-M`:

```bash
ansible server2 -b -a "systemctl --user -M webapp@ status web.service --no-pager"
```

```
● web.service - Static website in a rootless nginx container
     Loaded: loaded (/home/webapp/.config/containers/systemd/web.container; generated)
     Active: active (running) since Sat 2026-11-21 08:24:23 UTC; 29s ago
```

`podman` commands work with `become_user`, because Podman finds the runtime directory itself:

```bash
ansible server2 -b --become-user webapp -a "podman ps"
```

```
CONTAINER ID  IMAGE                                              COMMAND               CREATED         STATUS         PORTS                             NAMES
61784b9b1fd4  registry.access.redhat.com/ubi10/nginx-126:latest  nginx -g daemon o...  25 seconds ago  Up 25 seconds  0.0.0.0:8080->8080/tcp, 8443/tcp  web
```

## 8. Removing the container

To remove the container from a server, the spec stays in the playbook with `state: absent`:

```yaml
    podman_quadlet_specs:
      - name: web
        type: container
        state: absent
```

The run stopped the service, deleted `web.container` and turned off linger, because `webapp` had no other containers. Three things stayed:

- the firewall port `8080` (close it with `state: disabled`, as in section 6)
- the image in `webapp`'s storage
- `~webapp/site` with the content

Leaving the content is what you want: the next container can serve it again.

## Verification

From `~/ansible` on `server1`:

```bash
curl server1:8080; curl server2:8080                                   # <h1>server1</h1>, <h1>server2</h1>
ansible all -a "loginctl list-users"                                    # webapp ... yes lingering
ansible all -b -a "systemctl --user -M webapp@ is-active web.service"   # active
ansible all -b --become-user webapp -a "podman ps"                      # web, Up
ansible all -b -a "firewall-cmd --list-ports"                           # 8080/tcp
ansible-playbook containers.yml                                         # changed=0 on both
```

Then restart one server and run the `curl` again without logging in.

## Safety notes

- **Install `acl` on every server where Ansible becomes a regular user.** Without it, every task that runs as that user fails.
- **Use `-e podman_secure_logging=false` only for debugging.** It shows registry passwords in the output if you use them.
- **Use `Restart: always` for a service that should always run.** `on-failure` leaves it down after a clean exit.
- **Set a port in one variable.** Container and firewall then can't disagree.
- **Close old ports with `state: disabled`.** Removing a port from the list leaves it open.
- **Rootless containers can't use ports below 1024.** That's why the site is on `8080`. The manual lab shows the error.
