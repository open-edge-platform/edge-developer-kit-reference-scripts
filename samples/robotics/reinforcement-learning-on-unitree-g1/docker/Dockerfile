FROM node:22-bookworm-slim AS frontend-build

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ARG HUMANOID_RL_API_URL=http://127.0.0.1:8000
ARG NEXT_PUBLIC_HUMANOID_RL_TENSORBOARD_PORT=6767
ARG NEXT_PUBLIC_HUMANOID_RL_PLAYBACK_PORT=8181
ENV HUMANOID_RL_API_URL=${HUMANOID_RL_API_URL} \
    NEXT_PUBLIC_HUMANOID_RL_TENSORBOARD_PORT=${NEXT_PUBLIC_HUMANOID_RL_TENSORBOARD_PORT} \
    NEXT_PUBLIC_HUMANOID_RL_PLAYBACK_PORT=${NEXT_PUBLIC_HUMANOID_RL_PLAYBACK_PORT}

WORKDIR /application/frontend
COPY application/frontend/package.json application/frontend/package-lock.json ./
RUN npm ci
COPY application/frontend/ ./
RUN npm run build

FROM ubuntu:24.04

SHELL ["/bin/bash", "-lc"]

ARG DEBIAN_FRONTEND=noninteractive
ARG UV_VERSION=0.12.17

WORKDIR /app
ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python
COPY scripts /app/scripts
RUN chmod -R +x /app/scripts

RUN UV_VERSION="${UV_VERSION}" INSTALL_DEPS_SKIP_PLATFORM_INSTALL=1 INSTALL_DEPS_SKIP_GPU_CHECK=1 INSTALL_DEPS_INSTALL_GPU_RUNTIME=1 /app/scripts/install-deps.sh && \
    rm -rf /var/lib/apt/lists/*

RUN INSTALL_SKIP_GPU_CHECK=1 /app/scripts/install.sh

COPY application/backend /app/application/backend
RUN uv sync --project /app/application/backend --no-dev
COPY --from=frontend-build /usr/local/bin/node /usr/local/bin/node
COPY --from=frontend-build /application/frontend/.next/standalone /app/application/frontend
COPY --from=frontend-build /application/frontend/.next/static /app/application/frontend/.next/static
COPY --from=frontend-build /application/frontend/public /app/application/frontend/public
RUN node --version

RUN mkdir -p /app/.data /home/ubuntu && \
    chown ubuntu:ubuntu /app/.data /home/ubuntu

ENV HOME=/home/ubuntu
USER ubuntu

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "-e", "Promise.all(['http://127.0.0.1:'+(process.env.BACKEND_PORT||8000)+'/health','http://127.0.0.1:'+(process.env.FRONTEND_PORT||3000)+'/'].map(url=>fetch(url))).then(responses=>process.exit(responses.every(response=>response.ok)?0:1)).catch(()=>process.exit(1))"]

CMD ["/app/scripts/start-gui.sh"]
