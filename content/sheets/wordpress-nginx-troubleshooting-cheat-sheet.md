+++
title = "WordPress on Nginx Troubleshooting Cheat Sheet"
date = 2026-09-22
description = "Symptom-to-fix runbook for WordPress served by Nginx and PHP-FPM on Ubuntu: gateway errors, permissions, database issues, TLS, performance and server housekeeping."
tags = ["linux", "nginx", "wordpress", "troubleshooting", "sysadmin"]
+++

A symptom → likely cause → diagnose → fix runbook for a WordPress site served by Nginx as a reverse proxy to PHP-FPM on Ubuntu. Written for whoever is on call when the site goes down. Commands assume PHP 8.1 and a site root at `/var/www/example.com` — adjust paths to your own setup. Always run `nginx -t` before reloading.

## Start here

| You see | Likely area |
|---|---|
| Nginx's own error page, not WordPress | [502 Bad Gateway](#502-bad-gateway) or [504 Gateway Timeout](#504-gateway-timeout) |
| Upload fails immediately | [413 Request Entity Too Large](#413-request-entity-too-large) |
| Every URL is forbidden | [403 Forbidden on every page](#403-forbidden-on-every-page) |
| Homepage works, posts/admin don't | [404 on everything except the homepage](#404-on-everything-except-the-homepage) |
| Media uploader fails with no clear error | [Media uploads fail silently](#media-uploads-fail-silently) |
| Totally blank white page | [White screen, no error at all](#white-screen-no-error-at-all) |
| WordPress's own DB error page | [Error establishing a database connection](#error-establishing-a-database-connection) |
| Padlock warning after HTTPS migration | [Mixed content after moving to HTTPS](#mixed-content-after-moving-to-https) |
| Certificate about to expire, renewal fails | [Lets Encrypt renewal keeps failing](#lets-encrypt-renewal-keeps-failing) |
| Slow pages, or falls over under traffic | [Site is slow, or falls over under traffic](#site-is-slow-or-falls-over-under-traffic) |
| Disk full, everything failing at once | [Server disk full](#server-disk-full) |
| Config change didn't take effect | [nginx reload does nothing, or takes the site down](#nginx-reload-does-nothing-or-takes-the-site-down) |
| Emails / order confirmations never arrive | [Email or WooCommerce order mail not arriving](#email-or-woocommerce-order-mail-not-arriving) |

## Gateway & Proxy Errors

### 502 Bad Gateway

**Critical — site is down.** Nginx serves its own 502 page instead of WordPress. Happens right after a deploy, a traffic spike, or a server reboot.

Likely cause:
- PHP-FPM isn't running, or crashed and didn't restart
- Nginx is pointed at the wrong socket or port for PHP-FPM
- PHP-FPM ran out of workers and the pool is saturated

```bash
systemctl status php8.1-fpm                  # is the service actually up?
tail -n 50 /var/log/nginx/error.log          # look for "connect() failed" or "No such file"
ls -l /run/php/php8.1-fpm.sock               # confirm the socket exists
```

```bash
sudo systemctl restart php8.1-fpm                          # restart the pool
grep fastcgi_pass /etc/nginx/sites-available/example.com   # confirm it matches the socket above
sudo nginx -t && sudo systemctl reload nginx
```

> If PHP-FPM keeps dying under load, raise `pm.max_children` in `/etc/php/8.1/fpm/pool.d/www.conf` rather than just restarting on repeat.

### 504 Gateway Timeout

**Critical — site is down.** The page spins for a long time and then Nginx gives up with a 504, often on checkout, search, or admin-ajax requests.

Likely cause:
- A plugin or cron job (wp-cron) is running a slow query or remote call
- `fastcgi_read_timeout` is shorter than the request actually needs
- PHP-FPM has no free workers left, so the request queues until it times out

```bash
grep fastcgi_read_timeout /etc/nginx/sites-available/example.com /etc/nginx/nginx.conf
tail -f /var/log/nginx/error.log         # watch it live while you reproduce the slow page
wp cron event list --due-now              # is a heavy cron job the trigger?
```

```nginx
# in the server/location block:
fastcgi_read_timeout 120s;
```
```text
; and match it in the php-fpm pool config:
request_terminate_timeout = 120s
```
```bash
sudo nginx -t && sudo systemctl reload nginx
```

> Treat a timeout as a symptom, not the disease — find the slow query or external call first, then raise the ceiling only if it's genuinely needed.

### 413 Request Entity Too Large

Uploading a theme, plugin zip, or large media file fails immediately with 413, even though WordPress' own upload limit looks fine.

Likely cause:
- Nginx's `client_max_body_size` is smaller than the file
- PHP's `upload_max_filesize` or `post_max_size` caps it before Nginx even matters

```bash
grep client_max_body_size /etc/nginx/nginx.conf /etc/nginx/sites-available/example.com
php -i | grep -E 'upload_max_filesize|post_max_size'
```

```nginx
# in the server block:
client_max_body_size 64M;
```
```ini
; in /etc/php/8.1/fpm/php.ini:
upload_max_filesize = 64M
post_max_size = 64M
```
```bash
sudo systemctl reload nginx && sudo systemctl restart php8.1-fpm
```

> `post_max_size` must be ≥ `upload_max_filesize`, and Nginx's limit must be ≥ both, or the smallest one wins silently.

## Access, Rewrite & Permissions

### 403 Forbidden on every page

**Critical — site is down.** Every URL on the site — not just one page — returns Nginx's 403 Forbidden.

Likely cause:
- The web root or a parent directory isn't readable by the `www-data` user
- No index directive, and directory listing is off
- An overly broad `deny` rule in the server block

```bash
namei -l /var/www/example.com/index.php                        # traces permissions on every segment of the path
sudo -u www-data test -r /var/www/example.com/index.php && echo readable
```

```bash
sudo chown -R www-data:www-data /var/www/example.com           # or your configured PHP-FPM user
sudo find /var/www/example.com -type d -exec chmod 755 {} \;
sudo find /var/www/example.com -type f -exec chmod 644 {} \;
```

> WordPress needs `wp-content`, its uploads folder, and `wp-config.php` writable by the PHP-FPM user for updates and media — don't `chmod 777` to "fix" this.

### 404 on everything except the homepage

**Degraded.** The homepage loads, but every post, page, or `/wp-admin/` URL returns a 404 — a classic sign right after a migration to Nginx.

Likely cause:
- The server block has no `try_files` fallback to `index.php`, so Nginx looks for a literal file that doesn't exist
- Leftover `.htaccess` rewrite rules were copied over — Nginx ignores `.htaccess` entirely

```bash
grep -A2 'location /' /etc/nginx/sites-available/example.com
```

```nginx
# inside the server block:
location / {
    try_files $uri $uri/ /index.php?$args;
}
```
```bash
sudo nginx -t && sudo systemctl reload nginx
```

> Then in WordPress: **Settings → Permalinks → Save**, to flush rewrite rules against the new server.

### Media uploads fail silently

The uploader spins and fails, or says "Unable to create directory wp-content/uploads/2026/09", with no useful detail.

Likely cause:
- `wp-content/uploads` isn't writable by the PHP-FPM user
- Disk is actually full (see [Server disk full](#server-disk-full) below)

```bash
sudo -u www-data test -w /var/www/example.com/wp-content/uploads && echo writable
df -h /var/www
```

```bash
sudo chown -R www-data:www-data /var/www/example.com/wp-content/uploads
sudo find /var/www/example.com/wp-content/uploads -type d -exec chmod 755 {} \;
```

## Application & Data

### White screen, no error at all

**Critical — site is down.** Blank white page, no text, no HTTP error code shown to the visitor — the "White Screen of Death."

Likely cause:
- A PHP fatal error, with `display_errors` off so nothing is shown
- PHP hit its `memory_limit` mid-request
- A plugin or theme update introduced an incompatibility

```bash
tail -n 50 /var/log/php8.1-fpm.log
tail -n 50 /var/www/example.com/wp-content/debug.log   # if WP_DEBUG_LOG is enabled in wp-config.php
```

```bash
mv wp-content/plugins wp-content/plugins.disabled   # rename to disable all plugins at once
mkdir wp-content/plugins                             # then re-enable one at a time by moving them back
```
```php
// or raise the ceiling in wp-config.php:
define( 'WP_MEMORY_LIMIT', '256M' );
```

> Turn on logging first — `define('WP_DEBUG', true); define('WP_DEBUG_LOG', true); define('WP_DEBUG_DISPLAY', false);` — so the next blank page leaves a trail instead of nothing.

### Error establishing a database connection

**Critical — site is down.** WordPress's own database-error page, on every request.

Likely cause:
- MySQL/MariaDB service isn't running
- `wp-config.php` credentials or `DB_HOST` don't match reality (common after a server migration)
- Too many connections — the DB hit `max_connections` and is refusing new ones

```bash
systemctl status mysql
mysqladmin ping -u wp_user -p
grep -E 'DB_NAME|DB_USER|DB_HOST' /var/www/example.com/wp-config.php
```

```bash
sudo systemctl restart mysql
mysql -u wp_user -p -h 127.0.0.1 wp_database -e 'SELECT 1;'   # confirm the app user can actually reach the DB
```

> If it's `max_connections`, that's a capacity problem, not a config typo — find what's opening so many connections (often an object-cache misconfiguration) before just raising the limit.

## TLS & Certificates

### Mixed content after moving to HTTPS

The site loads over HTTPS but the browser shows "not fully secure" — some images, scripts, or links still point to `http://`.

Likely cause:
- WordPress' `siteurl`/`home` options are still set to `http://`
- Old posts have hardcoded `http://` URLs in post content, saved before the migration

```bash
wp option get siteurl
wp option get home
```

```bash
wp option update siteurl 'https://example.com'
wp option update home 'https://example.com'
wp search-replace 'http://example.com' 'https://example.com' --skip-columns=guid
```

> Run `search-replace` with `--dry-run` first to see what it would touch before committing.

### Lets Encrypt renewal keeps failing

**Degraded.** `certbot renew` reports a failure, usually noticed only when the certificate finally expires and browsers start warning visitors.

Likely cause:
- The ACME HTTP-01 challenge on port 80 is blocked by the firewall or a redirect-everything-to-https rule
- The certbot nginx plugin can't find/parse the server block it expects

```bash
sudo certbot renew --dry-run
sudo ufw status                     # port 80 must stay reachable for the challenge
```

```bash
sudo ufw allow 80/tcp
sudo certbot renew
systemctl list-timers | grep certbot   # confirm renewal is still checked twice a day, the certbot default
```

> Don't redirect port 80 to 443 unconditionally — carve out an exception for `/.well-known/acme-challenge/`, or let certbot's webroot plugin serve it directly.

## Performance Under Load

### Site is slow, or falls over under traffic

**Degraded.** Pages take seconds to render, or the site is fine at low traffic but times out during a spike.

Likely cause:
- No page or object caching, so every request re-runs the full WordPress bootstrap
- PHP OPcache is disabled or undersized
- `pm.max_children` in the PHP-FPM pool is too low for the server's RAM, so requests queue

```bash
curl -o /dev/null -s -w 'time_total: %{time_total}s\n' https://example.com/
php -i | grep opcache.enable
grep -E 'pm.max_children|pm =' /etc/php/8.1/fpm/pool.d/www.conf
```

```ini
; enable OPcache in /etc/php/8.1/fpm/php.ini:
opcache.enable=1
opcache.memory_consumption=128
```
```ini
; size pm.max_children to (available RAM / average PHP process size):
pm.max_children = 12
```
```bash
sudo systemctl restart php8.1-fpm
```

> Add a caching plugin (or Nginx `fastcgi_cache`) for logged-out page views before touching anything else — it usually buys the biggest win for the least risk.

## Server Housekeeping

### Server disk full

**Critical — site is down.** Everything starts failing at once — uploads, database writes, sometimes even SSH — and `df` shows 100% used.

Likely cause:
- Nginx or PHP-FPM logs grew unbounded because `logrotate` isn't running
- Old backup archives accumulated on the same volume as the site

```bash
df -h
du -sh /var/log/* 2>/dev/null | sort -rh | head -10
sudo find /var/www -name '*.log' -size +100M
```

```bash
sudo journalctl --vacuum-size=200M
sudo logrotate -f /etc/logrotate.d/nginx
cat /etc/logrotate.d/nginx   # then confirm logrotate actually runs on schedule
```

> Move backups off the app server entirely (object storage, a separate volume) rather than just deleting old ones when disk fills up.

### nginx reload does nothing, or takes the site down

**Degraded.** You edit a server block, reload, and the site either doesn't change or goes fully down.

Likely cause:
- A syntax error in the config — Nginx keeps the last-known-good config running until reload succeeds, silently masking the mistake
- Reloading after a config that fails validation, forcing a full restart that drops the master process

```bash
sudo nginx -t   # always run this before reload or restart, no exceptions
```

```bash
sudo systemctl reload nginx   # only if -t passed
```

> `reload` gracefully swaps workers with zero downtime; `restart` drops all connections. Reach for `restart` only if `reload` isn't picking up a change (e.g. a change to `worker_processes`).

### Email or WooCommerce order mail not arriving

Password resets, contact-form submissions, or order confirmations never reach the inbox, with WordPress showing no error.

Likely cause:
- PHP's `mail()` has nothing to relay through — most cloud providers block outbound port 25 by default
- No SMTP plugin configured, so `wp_mail()` silently fails

```bash
telnet smtp.your-provider.com 587   # confirm outbound access to an authenticated relay
wp eval 'var_dump( wp_mail("you@example.com", "test", "body") );'
```

```text
Install an SMTP plugin (WP Mail SMTP, etc.) and point it at an
authenticated relay (SES, Postmark, SendGrid) rather than local mail().
```

> Don't fight the provider's port-25 block — every major cloud host applies it by default to fight spam; route through a transactional email service instead.
