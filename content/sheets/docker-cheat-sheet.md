+++
title = "Docker Cheat Sheet"
date = 2026-09-19
description = "Run, build and manage Docker images and containers, plus volumes, networks, Compose basics and safe cleanup."
tags = ["linux", "docker", "containers", "devops"]
+++

A quick reference for `docker` — images, containers, volumes, networks, Compose, and cleaning up disk space without deleting something you still need.

## Checking Docker itself

```bash
docker --version    # installed Docker version
docker info          # daemon status, storage driver, resource limits
```

## Images

```bash
docker images                  # list images already pulled/built locally
docker pull nginx:1.25          # download an image from a registry (Docker Hub by default)
docker rmi nginx:1.25           # remove a local image (fails if a container still uses it)
docker build -t myapp:1.0 .     # build an image from ./Dockerfile, tagged myapp:1.0
```
`-t name:tag` names the image; without a tag, Docker defaults to `latest` — fine for local testing, risky to rely on in production since it silently means "whatever was pushed last."

## Running containers

```bash
docker run nginx                        # run in the foreground, attached to your terminal
docker run -d nginx                     # run detached (in the background)
docker run -d -p 8080:80 nginx          # map host port 8080 to the container's port 80
docker run -d --name web nginx          # give the container a memorable name instead of a random one
docker run -it ubuntu bash              # interactive terminal - useful for exploring an image
docker run -d -e ENV=production myapp   # pass an environment variable into the container
```
`-p host:container` is the flag you'll reach for constantly — without it, the container's ports aren't reachable from outside.

## Managing running/stopped containers

```bash
docker ps                # running containers only
docker ps -a              # all containers, including stopped ones
docker stop web            # gracefully stop a container (sends SIGTERM, then SIGKILL after a timeout)
docker start web           # start a previously stopped container again
docker restart web         # stop then start in one step
docker rm web              # remove a stopped container (add -f to force-remove a running one)
```

## Looking inside a running container

```bash
docker logs web            # print the container's stdout/stderr
docker logs -f web         # follow the logs live, like tail -f
docker exec -it web bash   # open an interactive shell inside a running container
docker inspect web         # full JSON details: IP, mounts, env vars, config
```
`exec` runs a NEW process inside an already-running container — it doesn't restart anything, so it's safe to use on production containers for a quick look around.

## Volumes (persistent data)

```bash
docker volume create app-data                     # create a named volume
docker volume ls                                   # list volumes
docker run -d -v app-data:/var/lib/mysql mysql     # mount a named volume into the container
docker run -d -v $(pwd)/html:/usr/share/nginx/html nginx  # mount a host directory (bind mount)
```
A named volume (`app-data:/path`) is managed by Docker and survives `docker rm` of the container; a bind mount (`$(pwd)/...:/path`) ties the container directly to a folder on the host — useful for live-editing code during development.

## Networks

```bash
docker network ls                          # list networks
docker network create app-net              # create a custom bridge network
docker run -d --network app-net --name db mysql   # attach a container to it
```
Containers on the same custom network can reach each other by container name (e.g. `db`) — no need to hardcode IP addresses.

## Docker Compose (multi-container apps)

```bash
docker compose up -d        # start everything defined in docker-compose.yml, detached
docker compose ps            # status of the services in this project
docker compose logs -f       # follow logs from all services together
docker compose down          # stop and remove containers, network (keeps volumes by default)
docker compose down -v       # also remove volumes - deletes their data
```
> `docker compose down -v` deletes volume data permanently. Leave off `-v` unless you specifically mean to wipe the app's persistent data too.

## Cleaning up disk space

```bash
docker container prune    # remove all stopped containers
docker image prune         # remove dangling (untagged) images
docker image prune -a      # remove ALL images not used by any container - much more aggressive
docker system prune        # remove stopped containers, dangling images, and unused networks in one go
docker system df           # see how much space images/containers/volumes are actually using
```
> `docker system prune -a` and `docker image prune -a` can delete images you'd need to re-download or rebuild later. Run `docker system df` first so you know what you're actually reclaiming.

## Quick Dockerfile reference

```dockerfile
FROM node:20-alpine        # base image to build on top of
WORKDIR /app                # sets the working directory for the following instructions
COPY package.json .         # copy files from build context into the image
RUN npm install              # runs a command at build time, result baked into the image
COPY . .                     # copy the rest of the app
EXPOSE 3000                  # documents which port the container listens on (doesn't publish it)
CMD ["node", "server.js"]    # the default command run when a container starts
```

## Safety notes

- Being in the `docker` group is effectively root-equivalent on the host — anyone who can run `docker` can mount the host filesystem into a container and read/write anything. Grant it as carefully as you would `sudo`.
- Avoid `--privileged` unless a container genuinely needs full device access; it removes most of the isolation containers are meant to provide.
- Never expose the Docker daemon socket (`/var/run/docker.sock`) into a container unless you fully trust that image — it hands the container root control over the host.
- Check `docker system df` before any `prune -a` command — those delete image layers you may need again.
