+++
title = "Diagnosing an SELinux \"denied\" Problem on a Real Service"
date = 2026-10-13
description = "Nginx returns 403 for a site moved to a non-standard directory, even though every Unix permission looks correct. Diagnosing it's actually SELinux, reading the denial, and fixing it permanently with semanage fcontext + restorecon instead of the chcon shortcut or disabling SELinux."
tags = ["linux", "selinux", "nginx", "troubleshooting", "rhel"]
+++

**Goal:** move a site's document root to a non-standard location, hit a 403 that has nothing to do with Unix permissions, confirm SELinux is actually the cause rather than guessing, and fix it the way that survives a reboot and a relabel - not the way that just makes the symptom disappear for now.

**Why this is worth doing deliberately:** this exact shape of problem - permissions look fine, config looks fine, it still doesn't work - is the single most common way people conclude "SELinux is broken" and disable it. It isn't broken; it's doing precisely what it's configured to do, and the fix is two commands once the actual cause is confirmed instead of assumed.

## 1. The setup: serving from a non-standard directory

```bash
sudo mkdir -p /srv/webdata
echo "<h1>It works (allegedly)</h1>" | sudo tee /srv/webdata/index.html
sudo chown -R nginx:nginx /srv/webdata     # correct ownership
sudo chmod -R 755 /srv/webdata               # correct permissions
```

```nginx
# /etc/nginx/conf.d/webdata.conf
server {
    listen 80;
    server_name webdata.example.com;
    root /srv/webdata;      # not the default /usr/share/nginx/html
    index index.html;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx   # config syntax is valid, reload applies it
```

Ownership is correct, permissions are correct, the config itself is valid - by every normal Unix measure, this should already work.

## 2. The symptom

```bash
curl -I http://webdata.example.com/
# HTTP/1.1 403 Forbidden
```

A 403 with `chmod 755` and correct ownership already in place is the signature of this exact problem - if it were a real permissions issue, it would be a different error or it simply wouldn't have passed the `ls -l` check in step 1 at all.

## 3. Confirm it's actually SELinux, don't assume it

```bash
getenforce   # Enforcing
```

```bash
sudo setenforce 0                        # temporarily permissive - diagnostic only, see the warning below
curl -I http://webdata.example.com/        # HTTP/1.1 200 OK  - confirms SELinux was the cause
sudo setenforce 1                            # back to enforcing immediately - this proved the cause, it isn't the fix
```

> `setenforce 0` here is a **diagnostic step, not a fix** - its only purpose is answering "is SELinux actually involved at all" with a yes/no before spending time on the wrong theory. Re-enable enforcing mode immediately after this check, in the same breath as running it - the real fix happens in sections 5-6, with SELinux still fully enforcing.

## 4. Read the actual denial, don't just trust the toggle test

```bash
sudo ausearch -m avc -ts recent
```

```text
type=AVC msg=audit(...): avc:  denied  { read } for  pid=5821 comm="nginx"
    name="index.html" dev="sda1" ino=131082
    scontext=system_u:system_r:httpd_t:s0
    tcontext=unconfined_u:object_r:default_t:s0
    tclass=file
```

`scontext=httpd_t` (what nginx runs as) against `tcontext=default_t` (what `/srv/webdata` actually got labeled, since it's outside any directory policy already knows about) is the whole diagnosis in two lines - nginx is confined to reading `httpd_sys_content_t`-labeled files, and this directory isn't one.

## 5. See the mismatch directly

```bash
ls -Zd /srv/webdata /usr/share/nginx/html
```

```text
unconfined_u:object_r:default_t:s0           /srv/webdata
system_u:object_r:httpd_sys_content_t:s0       /usr/share/nginx/html
```

`/srv/webdata` landed on the generic `default_t` type because nothing in SELinux's file-context policy knows that path should be treated as web content - it has nothing to do with where `/usr/share/nginx/html` itself is, only with what policy has been told about each specific path.

## 6. Fix it permanently - not with chcon

```bash
sudo chcon -t httpd_sys_content_t -R /srv/webdata   # works immediately - and is the wrong fix, see below
```

This single command would make the 403 disappear right now. It's also exactly the trap: `chcon` changes the label in place without writing anything to the policy database, so the **next** `restorecon -R /`, a `semanage` operation elsewhere, or a full relabel (triggered by `touch /.autorelabel` - see the [boot process cheat sheet](/sheets/boot-process-grub-cheat-sheet/)) reverts it back to `default_t` with no warning, and the exact same 403 returns days or weeks later with no obvious cause. The fix that actually survives:

```bash
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/webdata(/.*)?'   # teach policy about this path, permanently
sudo restorecon -Rv /srv/webdata                                          # apply the now-correct rule to existing files
```

`restorecon -v` prints every file it actually relabels - seeing `/srv/webdata/index.html` listed confirms the rule applied, not just that the command ran without error.

## 7. Confirm the fix holds with SELinux still enforcing

```bash
getenforce                                 # Enforcing - never left permissive to "test" the real fix
curl -I http://webdata.example.com/          # HTTP/1.1 200 OK
```

This is the step that actually proves the fix, as opposed to step 3's temporary permissive check - the site works now with SELinux doing its normal job, not because enforcement was switched off.

## Verification - prove it's actually permanent

```bash
sudo semanage fcontext -l | grep webdata        # the policy rule is there, not just applied once
sudo restorecon -Rv /srv/webdata                   # run it again - should report NOTHING changed this time
```

```bash
sudo ausearch -m avc -ts recent | grep webdata     # confirm no new denials after re-testing the site
```

A second `restorecon -Rv` reporting zero changes is the real confirmation - it means the files already match policy exactly, so any future relabel or `restorecon -R /` leaves this directory untouched instead of reverting it.

## Safety notes

- `setenforce 0` is for confirming a diagnosis, never for resolving one - re-enable enforcing in the same breath as disabling it, and do the actual fix with enforcement back on.
- `chcon` is not wrong to use for a quick same-session test, but treat anything fixed with only `chcon` as still broken - it reverts on the next relabel with no warning. `semanage fcontext` + `restorecon` is the version of this fix that's actually done.
- Scope `semanage fcontext` rules and `restorecon` runs to the exact path involved - a rule or a relabel aimed too broadly (especially anything starting from `/`) affects far more than the one directory being fixed.
- A denial doesn't automatically mean "find the type and relabel it" - occasionally the correct fix is a boolean (`httpd_can_network_connect` for a reverse proxy, for example) rather than a context change; `ausearch`'s `tclass` and the specific permission denied (`name_connect`, `read`, etc.) usually point at which one applies.
- If `/usr/share/nginx/html` is no longer used at all, it's still a legitimate `httpd_sys_content_t`-labeled path - don't repurpose it for something that needs a different context without relabeling it too, or a later service expecting the original type there will fail in a way that looks unrelated to this change.
