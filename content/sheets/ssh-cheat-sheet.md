+++
title = "SSH Cheat Sheet"
date = 2026-09-18
description = "Connect, authenticate with keys, configure ~/.ssh/config, transfer files, tunnel ports, and harden sshd safely."
tags = ["linux", "ssh", "networking", "security", "sysadmin"]
+++

A quick reference for `ssh` — connecting to remote servers, managing keys, moving files, tunneling, and locking down the server side without locking yourself out.

## Basic connection

```bash
ssh user@host              # connect as "user" to "host" on the default port (22)
ssh -p 2222 user@host      # connect using a non-default port
```
`-p` selects a non-default port. Without a username, `ssh` defaults to your current local username.

## Key-based authentication

```bash
ssh-keygen -t ed25519 -C "you@example.com"   # generate a new keypair, comment is just a label
ssh-copy-id user@host                        # copy your public key into the remote authorized_keys
```
`ed25519` is the modern default — smaller and faster than RSA, with no known weaknesses at reasonable key sizes. `ssh-copy-id` appends your public key to the remote `~/.ssh/authorized_keys` for you, over a normal password login.

```bash
chmod 700 ~/.ssh                  # only you can access this directory at all
chmod 600 ~/.ssh/id_ed25519       # private key: owner read/write only
chmod 644 ~/.ssh/id_ed25519.pub   # public key: fine to be world-readable
```
> SSH silently refuses to use a private key if its permissions are too open. `600` (owner read/write only) is required, and `700` on `~/.ssh` itself keeps other users out entirely.

## `~/.ssh/config` — shortcuts for hosts you use often

```text
Host prod                           # alias you'll type instead of the details below
    HostName 203.0.113.10           # actual IP or hostname to connect to
    User deploy                     # username to log in as
    Port 2222                       # non-default SSH port
    IdentityFile ~/.ssh/id_ed25519  # which private key to use for this host
```
```bash
ssh prod   # uses every setting above automatically
```
Once defined, `ssh prod` (or `scp file prod:/path`) uses all of those settings automatically — no more re-typing IP, user, and port every time.

## Copying files

```bash
scp file.tgz user@host:/tmp/                # copy a local file to a remote path
scp -P 2222 user@host:/var/log/app.log ./   # copy a remote file to the current directory
scp -r ./dist/ user@host:/var/www/app/      # copy a directory recursively
```
`-P` (capital) sets the port for `scp` — note it's different from `ssh`'s lowercase `-p`. For anything recurring or resumable, prefer `rsync -e ssh` instead.

```bash
sftp user@host   # open an interactive file-transfer session
```
An interactive alternative to `scp`, with `get`/`put`/`ls`/`cd` commands — useful for browsing before transferring.

## Running a remote command without a full session

```bash
ssh user@host 'df -h && uptime'   # run a command remotely, print its output locally, then disconnect
```
Runs the command on the remote host and returns, without dropping you into an interactive shell — handy in scripts.

## Port forwarding (tunneling)

```bash
ssh -L 8080:localhost:80 user@host   # local forward: reach the remote's port 80 via localhost:8080
```
**Local forward:** makes the remote's port 80 reachable at `localhost:8080` on your machine — e.g. reaching an internal admin panel that only listens on the server itself.

```bash
ssh -R 9000:localhost:3000 user@host   # remote forward: expose local port 3000 on the remote's localhost:9000
```
**Remote forward:** makes YOUR local port 3000 reachable from the remote host at its `localhost:9000` — e.g. temporarily exposing a local dev server to a remote box.

```bash
ssh -D 1080 user@host   # dynamic forward: turn this connection into a SOCKS proxy on port 1080
```
**Dynamic forward:** turns the SSH connection into a SOCKS proxy on local port 1080 — route a browser's traffic through the remote server.

## Jumping through a bastion host

```bash
ssh -J bastion user@internal-host   # hop through "bastion" to reach internal-host in one command
```
Chains through `bastion` to reach `internal-host` in one command, instead of manually SSH-ing into the bastion first and then again from there. Works well combined with `~/.ssh/config` host aliases.

## Keeping the connection alive

```text
Host *
    ServerAliveInterval 60   # send a keepalive packet every 60 seconds
    ServerAliveCountMax 3    # give up after 3 missed replies
```
Add to `~/.ssh/config` to stop idle connections from being silently dropped by NAT devices or firewalls — a keepalive packet every 60s, tolerating 3 missed replies before giving up.

## Server-side hardening (`/etc/ssh/sshd_config`)

```bash
sudo nano /etc/ssh/sshd_config   # edit the server-side SSH daemon config
```

```text
PermitRootLogin no          # disable direct root login over SSH
PasswordAuthentication no   # require key-based login only
Port 2222                   # listen on a non-default port
```

After editing, always validate before restarting:

```bash
sudo sshd -t                   # validate the config syntax before restarting
sudo systemctl restart sshd    # apply the new config
```

> **Do this in the right order or you can lock yourself out permanently:** confirm key-based login works for your account *first*, keep your current session open, test a **new** connection in a second terminal after each change, and only disable `PasswordAuthentication` once you've confirmed key login succeeds. `sshd -t` catches syntax errors before they reach a running config.

## Troubleshooting

```bash
ssh -v user@host   # verbose output - shows each step of the connection attempt
```
`-v` (repeatable up to `-vvv`) prints what the client is trying and where it fails — the first thing to reach for when a connection behaves unexpectedly.

```bash
ssh-keygen -R host   # remove a stale/changed entry for "host" from known_hosts
```
Removes a stale entry from `~/.ssh/known_hosts` — needed after a legitimate host key change (e.g. the server was rebuilt), which otherwise shows as a scary "REMOTE HOST IDENTIFICATION HAS CHANGED" warning. Confirm the change is expected before removing it — that warning is also exactly what a machine-in-the-middle attack looks like.

## Safety notes

- Never disable `PasswordAuthentication` before verifying key-based login actually works — test in a second, still-open session.
- Keep private keys `600` and never share or commit them; if one might be compromised, revoke it (remove from `authorized_keys`) and generate a new pair.
- Prefer `PermitRootLogin no` and a regular user with `sudo`, rather than logging in as root directly.
- A changed host-key warning is not always an attack, but never dismiss it without confirming why the server's key actually changed.
