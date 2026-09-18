+++
title = "systemctl Cheat Sheet"
date = 2026-08-26
description = "Useful systemctl commands for managing Linux services."
tags = ["linux", "systemd", "services"]
+++

A quick reference for checking, starting, stopping, and enabling system services.

## Check a service

```bash
systemctl status nginx
```

## Start or stop a service

```bash
systemctl start nginx
systemctl stop nginx
```

## Enable a service at boot

```bash
systemctl enable nginx
```
