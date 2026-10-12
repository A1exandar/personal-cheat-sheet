+++
title = "SELinux Cheat Sheet"
date = 2026-10-13
description = "SELinux modes, reading and changing file context with semanage and restorecon (not chcon), booleans, and reading AVC denials - the parts that are a genuine knowledge gap for most people studying for RHCSA, who often just disable SELinux instead of learning it."
tags = ["linux", "selinux", "security", "rhel", "sysadmin"]
+++

SELinux enforces a second, independent permission system on top of normal Unix permissions - a process can pass every `rwx` check and still get blocked, because its SELinux *context* doesn't match what policy allows for that type of file or port. This is the single most common reason a service "should work" (permissions look fine, the config looks fine) and still returns a permission error.

## SELinux modes

```bash
getenforce                  # current mode: Enforcing, Permissive, or Disabled
sudo setenforce 0              # switch to Permissive right now - temporary, lost on reboot
sudo setenforce 1                # switch back to Enforcing right now
```

```bash
sudo nano /etc/selinux/config   # SELINUX=enforcing|permissive|disabled - takes effect on next reboot
```

```text
Enforcing    policy violations are blocked and logged
Permissive   policy violations are only logged, nothing is blocked - useful for diagnosis, not a fix
Disabled     no SELinux at all - no blocking and no logging either, losing the audit trail too
```

> `setenforce 0` is a **diagnostic tool**, not a fix - using it to confirm SELinux is the cause of a problem is standard practice; leaving a system in Permissive (or switching to Disabled) because that made the error go away is not a fix, it's turning off the thing that was correctly doing its job. See the [SELinux denied troubleshooting lab](/labs/selinux-denied-troubleshooting/) for this used correctly, as one diagnostic step among several.

## Reading SELinux context

```bash
ls -Z /var/www/html/              # file contexts
ps -Z -C nginx                       # the context a running process is actually in
id -Z                                   # the current shell's own context
```

```text
unconfined_u:object_r:httpd_sys_content_t:s0
      ^            ^              ^         ^
      user         role           type      sensitivity level
```

The **type** (`httpd_sys_content_t` above) is what matters for almost everything day-to-day - it's what policy rules actually key off when deciding whether a process can read, write, or execute a given file. The user/role/level fields matter far less on a typical single-purpose server.

## Changing context: chcon vs. semanage + restorecon

```bash
sudo chcon -t httpd_sys_content_t /srv/webdata/index.html   # changes the label on this file, right now
```

```bash
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/webdata(/.*)?'   # add a persistent policy rule for this path
sudo restorecon -Rv /srv/webdata                                           # apply it to the files that actually exist
```

```text
chcon                    semanage fcontext + restorecon
-----                    ------------------------------
Changes the label now    Writes a rule to the policy database itself
Temporary                Persistent
Lost on the next         Survives restorecon, a full relabel,
restorecon/relabel        and reinstalling the package that owns the path
Fine for a quick test     The actual fix for anything meant to stay
```

> `chcon` is the trap here - it makes the symptom disappear immediately, which looks like success, but the very next `restorecon -R /` (or an automatic relabel, like the one `touch /.autorelabel` triggers - see the [boot process cheat sheet](/sheets/boot-process-grub-cheat-sheet/#recovery-resetting-a-lost-root-password-with-rdbreak)) silently reverts it and the original problem comes back with no obvious cause. Use `semanage fcontext` + `restorecon` for anything that needs to survive more than the current moment.

## Finding the right context type for a path

```bash
matchpathcon /var/www/html/index.html          # what context *should* this path have, per current policy
semanage fcontext -l | grep httpd_sys            # list existing policy rules matching a type name
```

`matchpathcon` is the fastest way to answer "what type am I actually supposed to use here" without guessing or searching documentation - it checks the same policy database `restorecon` reads from.

## SELinux booleans - policy on/off switches

```bash
getsebool -a | grep httpd                 # every httpd-related boolean and its current state
sudo setsebool httpd_can_network_connect on       # change it now, temporary - lost on reboot
sudo setsebool -P httpd_can_network_connect on      # -P makes it persistent across reboots
```

Booleans toggle entire pre-defined chunks of policy without writing custom rules - `httpd_can_network_connect`, for example, is exactly what a reverse-proxy or anything calling out to another service over the network needs enabled, and is off by default.

## Reading AVC denials

```bash
sudo ausearch -m avc -ts recent               # recent denials from the audit log, in a readable form
sudo journalctl -t setroubleshoot                # if setroubleshoot is installed, plain-English summaries instead
```

```text
type=AVC msg=audit(...): avc:  denied  { read } for  pid=1234 comm="nginx"
    scontext=system_u:system_r:httpd_t:s0
    tcontext=unconfined_u:object_r:default_t:s0
    tclass=file
```

```text
scontext   the context the PROCESS was running as when it got blocked
tcontext   the context of the TARGET (the file/port/etc it was trying to access)
tclass     what kind of object it was trying to act on (file, dir, tcp_socket, ...)
```

The mismatch between `scontext`'s expected type and `tcontext`'s actual type is the whole story - here, `httpd_t` trying to read something still labeled `default_t` instead of an `httpd_*` type, which is exactly the "served from a non-standard directory" scenario in the troubleshooting lab.

## Common recipes

```bash
# Confirm whether SELinux is actually the cause of a given error (diagnostic only - see the warning above)
sudo setenforce 0; <reproduce the problem>; sudo setenforce 1

# Permanently fix a "wrong context" problem for an entire directory tree
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/webdata(/.*)?'
sudo restorecon -Rv /srv/webdata

# Let a web server make outbound connections (reverse proxy, remote API calls, etc.)
sudo setsebool -P httpd_can_network_connect on

# See the last few denials in plain language
sudo ausearch -m avc -ts recent | audit2why
```

## Safety notes

- Never leave a production system in Permissive mode, or switch it to Disabled, as "the fix" for a denial - both remove real protection; Permissive also still logs (useful), Disabled does not (actively worse for ever diagnosing anything again).
- Prefer `semanage fcontext` + `restorecon` over `chcon` for anything that should still work after the next relabel, package update, or `restorecon -R /` - `chcon` changes are real but **not** written to policy, so they're silently temporary.
- Scope `restorecon`/`chcon` commands to the exact path that needs it - running either recursively from `/` is destructive to the system's labeling and not something to do "just in case."
- `audit2allow` can generate a custom policy module from denials automatically, but reach for the standard `semanage fcontext`/`setsebool` tools first - a hand-rolled policy module is a last resort for something policy genuinely has no existing type or boolean for, not a shortcut around understanding the denial.
- Install `setroubleshoot-server` (`sudo dnf install setroubleshoot-server`) on a system used for learning/troubleshooting - `sealert`/`journalctl -t setroubleshoot` turn cryptic AVC lines into a plain-language explanation and a suggested fix.
