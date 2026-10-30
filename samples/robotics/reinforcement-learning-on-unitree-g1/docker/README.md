# Docker

Docker image to run video-to-robot reinforcement learning for the Unitree G1 robot. Comes packaged, with:

- [uv](https://docs.astral.sh/uv/)
- [GVHMR](https://github.com/zju3dv/GVHMR.git)
- [GMR](https://github.com/YanjieZe/GMR.git)
- [unitree_rl_mjlab](https://github.com/unitreerobotics/unitree_rl_mjlab.git)

If using a remote server, connect with SSH X11 forwarding and local port tunnels. For example:
```
ssh -X \
  -L 3008:localhost:3008 \
  -L 8008:localhost:8008 \
  -L 6767:localhost:6767 \
  -L 8181:localhost:8181 \
	user@server
```

Make sure you are in the render group.

```
getent group render
```

If you are missing, add yourself by:

```
sudo usermod -aG render $USER
newgrp render
```

## Proxy Setup

If you are using a proxy, make sure to setup the proxy in `/etc/docker/daemon.json`:
```
{
  "proxies": {
    "http-proxy": "http://YOUR_PROXY:PORT",
    "https-proxy": "http://YOUR_PROXY:PORT",
    "no-proxy": "localhost,127.0.0.1"
  }
}
```

## Build

```
RENDER_GID=$(getent group render | cut -d: -f3) \
docker compose --env-file application/.env -f docker/compose.yml build
```

## Run

For the GUI container, start the service:

```
RENDER_GID=$(getent group render | cut -d: -f3) \
docker compose --env-file application/.env -f docker/compose.yml up
```

To open an interactive login shell instead of starting the GUI:

```bash
RENDER_GID=$(getent group render | cut -d: -f3) \
docker compose --env-file application/.env -f docker/compose.yml \
  run --rm --service-ports --entrypoint /bin/bash humanoid-rl-intel -l
```

Note: The `/home/ubuntu` tmpfs is executable because Warp builds and dynamically loads its SYCL shared library from `~/.cache/warp`.