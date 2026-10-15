FROM node:22-bookworm-slim AS frontend-build

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ARG HUMANOID_RL_API_URL=http://127.0.0.1:8000

ENV HUMANOID_RL_API_URL=${HUMANOID_RL_API_URL}

WORKDIR /application/frontend
COPY application/.env /application/.env
COPY application/frontend/package.json application/frontend/package-lock.json ./
RUN npm ci
COPY application/frontend/ ./
RUN npm run build

FROM ubuntu:24.04

SHELL ["/bin/bash", "-lc"]

ARG DEBIAN_FRONTEND=noninteractive

WORKDIR /app
COPY data /app/data
COPY scripts /app/scripts
RUN chmod -R +x /app/scripts

RUN INSTALL_DEPS_SKIP_PLATFORM_INSTALL=1 INSTALL_DEPS_SKIP_GPU_CHECK=1 INSTALL_DEPS_INSTALL_GPU_RUNTIME=1 /app/scripts/install-deps.sh && \
    rm -rf /var/lib/apt/lists/*

RUN INSTALL_SKIP_GPU_CHECK=1 /app/scripts/install.sh

# WORKDIR /app/unitree_sdk2
# RUN mkdir build && \
#     cd build && \
#     cmake .. && \
#     make && \
#     make install
# WORKDIR /app/unitree_rl_mjlab
# RUN cd /app/unitree_rl_mjlab/deploy/robots/g1 && \
#     mkdir build && \
#     cd build && \
#     cmake .. && \
#     make
# RUN cd /app/unitree_rl_mjlab/simulate && \
#     mkdir build && \
#     cd build && \
#     cmake .. && \
#     make

COPY application/backend /app/application/backend
COPY application/.env /app/application/.env
RUN uv sync --project /app/application/backend --no-dev
COPY --from=frontend-build /usr/local/ /usr/local/
COPY --from=frontend-build /application/frontend/.next/standalone /app/application/frontend
COPY --from=frontend-build /application/frontend/.next/static /app/application/frontend/.next/static
COPY --from=frontend-build /application/frontend/public /app/application/frontend/public

CMD ["/app/scripts/start-gui.sh"]
