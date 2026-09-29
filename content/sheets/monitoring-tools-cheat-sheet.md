+++
title = "Open Source Monitoring Tools Cheat Sheet"
date = 2026-09-29
description = "Monitor Linux systems with htop, glances and netdata for quick host-level checks, plus how Zabbix and Grafana fit in for fleet-wide monitoring and dashboards."
tags = ["linux", "monitoring", "htop", "netdata", "sysadmin"]
+++

Four different tools, four different jobs: `htop` and `glances` are for "what's happening on this box right now", `netdata` adds a real-time web dashboard with almost zero setup, and Zabbix + Grafana are what you reach for once you're monitoring a fleet of servers instead of just one.

## htop - interactive process viewer

```bash
sudo apt install htop     # Debian/Ubuntu
sudo dnf install htop      # RHEL/Fedora
htop                        # launch it - no flags needed for basic use
```

```text
F2    Setup - change colors, meters, columns
F3    Search for a process by name
F4    Filter the process list by name
F5    Tree view - show parent/child process relationships
F6    Change the sort column
F9    Kill the selected process (choose the signal)
F10 / q   Quit
Space     Tag a process (act on multiple at once)
```

```bash
htop -u www-data       # only show processes owned by this user
htop -p 1234,5678        # only show these specific PIDs
htop -d 5                  # update every 0.5 seconds (delay is in tenths of a second)
```

The three meter bars at the top (CPU per-core, memory, swap) update live - a quick glance tells you whether you're CPU-bound, memory-bound, or swapping, before you dig into individual processes.

## glances - cross-platform system overview

```bash
sudo apt install glances     # Debian/Ubuntu
sudo dnf install glances      # RHEL/Fedora
pip install glances            # latest version, any distro
glances                          # launch the interactive terminal view
```

```bash
glances -w              # web server mode - view at http://<host>:61208 from any browser
glances --export influxdb   # stream metrics out to InfluxDB, Prometheus, etc.
glances -t 5              # refresh every 5 seconds instead of the 3s default
glances --disable-network    # hide a section you don't care about, to fit more on screen
```

```text
inside glances:
a     sort processes by CPU (default)
m     sort processes by memory
c     sort by CPU, alternate mode
d     show/hide disk I/O section
q     quit
```

Where `htop` focuses entirely on processes, `glances` gives one screen with CPU, memory, disk I/O, network, sensors and processes all at once - a faster "is this server healthy" check, at the cost of less process-level detail than `htop`.

## netdata - real-time monitoring dashboard

```bash
# One-line installer - see the safety note below before running this on a server you don't control
curl -SsL https://get.netdata.cloud/kickstart.sh | sh

sudo systemctl status netdata      # confirm it's running
sudo systemctl enable --now netdata  # enable on boot + start now
```

```bash
http://<server-ip>:19999          # the dashboard - no login required by default (see safety notes)
```

```bash
sudo systemctl restart netdata          # apply a config change
sudo nano /etc/netdata/netdata.conf       # main config file
sudo /etc/netdata/edit-config health_alarm_notify.conf   # configure alert notifications (email, Slack, etc.)
```

netdata auto-detects almost everything running on the host (nginx, MySQL, Docker containers, disks) and starts charting it within seconds of install, with per-second resolution - the fastest way to get a real dashboard with no manual configuration.

## Zabbix - fleet-wide monitoring

Zabbix is a full client-server monitoring system: a central **server** (and optional **proxy** for remote sites) polls or receives data from an **agent** installed on every monitored host, stores history in a database, and evaluates triggers/alerts centrally.

```bash
# On each monitored host - just the agent, not the full server
sudo apt install zabbix-agent2
sudo systemctl enable --now zabbix-agent2
```

```ini
# /etc/zabbix/zabbix_agent2.conf - the two lines that matter for a basic setup
Server=10.0.0.5          # IP of the Zabbix server allowed to query this agent
ServerActive=10.0.0.5     # IP the agent should push active-check data to
Hostname=web01             # must match the host's name as configured in the Zabbix frontend
```

```bash
zabbix_agent2 -t agent.ping          # test a single item key locally, without the server
sudo systemctl restart zabbix-agent2   # apply a config change
tail -f /var/log/zabbix/zabbix_agent2.log   # watch the agent's own logs
```

The Zabbix **server** itself (web frontend, database, alerting engine) is typically installed once on a dedicated host, not on every machine you monitor - see the official Zabbix docs for that install, since it's a bigger multi-package setup (server + frontend + a database like MySQL/PostgreSQL) beyond the scope of a quick cheat sheet.

## Grafana - dashboards on top of your metrics

Grafana doesn't collect metrics itself - it's a dashboard/visualization layer that queries a data source (Prometheus, Zabbix, InfluxDB, netdata, and others) and renders graphs from it.

```bash
sudo apt install -y software-properties-common
sudo add-apt-repository "deb https://packages.grafana.com/oss/deb stable main"
sudo apt update && sudo apt install grafana

sudo systemctl enable --now grafana-server
```

```bash
http://<server-ip>:3000          # default web UI, default login admin/admin (change it immediately)
```

```bash
sudo systemctl restart grafana-server
sudo nano /etc/grafana/grafana.ini      # main config file (ports, auth, plugins)
grafana-cli plugins install <plugin-name>  # add a data source/panel plugin
```

## Choosing between them

| Tool | Best for | Setup effort |
|---|---|---|
| `htop` | A quick look at processes on the box you're already SSH'd into | None - just install |
| `glances` | A one-screen overview of CPU/mem/disk/net on a single host | None - just install |
| `netdata` | Instant per-second dashboards on a single host, zero config | Very low |
| `Zabbix` | Centralized monitoring + alerting across many servers, long-term history | High (server + agents + DB) |
| `Grafana` | Pretty, shareable dashboards built from Zabbix/Prometheus/netdata/etc. data | Medium (needs a data source already collecting metrics) |

## Common recipes

```bash
# Fastest possible check when you SSH into an unfamiliar server
htop

# One-screen health check including disk and network, no scrolling needed
glances

# See if netdata is already running on a box someone else set up
curl -s http://localhost:19999/api/v1/info | head -5

# Confirm a Zabbix agent can actually reach and be reached by its server
zabbix_agent2 -t agent.ping
sudo ss -tlnp | grep zabbix
```

## Safety notes

- The netdata `kickstart.sh` one-liner pipes a remote script straight into `sh` - fine on your own machine where you trust the source, but read the script first (`curl -SsL ... | less`) before running it on a server you're responsible for, same as any curl-to-shell installer.
- netdata's dashboard has **no authentication by default** and listens on `0.0.0.0:19999` - on a server with a public IP, put it behind a firewall rule, reverse proxy with auth, or netdata's own `nginx`/basic-auth config before leaving it running.
- Grafana ships with a default `admin/admin` login - change it on first login, and don't skip this step even on an internal-only network.
- A Zabbix agent in **active** mode connects outbound to the server (fewer firewall holes needed on the monitored host); **passive** mode requires the server to reach the agent's port inbound - pick based on what your firewall setup actually allows before troubleshooting "why is monitoring not working."
