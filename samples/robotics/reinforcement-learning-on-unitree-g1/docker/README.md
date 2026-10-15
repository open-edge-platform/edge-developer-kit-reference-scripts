# Docker

Docker image to run video-to-robot reinforcement learning for the Unitree G1 robot. Comes packaged, with:

- [uv](https://docs.astral.sh/uv/)
- [GVHMR](https://github.com/zju3dv/GVHMR.git)
- [GMR](https://github.com/YanjieZe/GMR.git)
- [unitree_rl_mjlab](https://github.com/unitreerobotics/unitree_rl_mjlab.git)

If using a remote server, connect with SSH X11 forwarding and local port tunnels. For example:
```
ssh -X \
	-L 8080:localhost:8080 \
  -L 6007:localhost:6007 \
  -L 8081:localhost:8081 \
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
docker compose -f docker/compose.yml build
```

## Run
```
docker compose -f docker/compose.yml up
```

For the GUI container, start the service in the background:

```bash
RENDER_GID=$(getent group render | cut -d: -f3) \
docker compose -f docker/compose.yml up --build
```



# Credits

Thank you to [@xiangyang-95](https://github.com/xiangyang-95) for putting together initial version.