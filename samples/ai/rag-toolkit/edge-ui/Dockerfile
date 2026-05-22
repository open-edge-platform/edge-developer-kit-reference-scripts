# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

FROM debian:12-slim AS base
ARG DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV NEXT_TELEMETRY_DISABLED 1
ENV PORT 3000
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install --no-install-recommends -y \
    sudo \
    curl \
    ca-certificates \
    && addgroup --system intel --gid 1000 \
    && adduser --system --ingroup intel --uid 1000 --home /home/intel intel \
    && echo "intel ALL=(ALL:ALL) NOPASSWD:ALL" > /etc/sudoers.d/intel \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install --no-install-recommends -y \
    nodejs \
    && node -v \
    && npm -v \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app \
    && chown -R intel:intel /app

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
  CMD npm --version || exit 1

FROM base AS development
ENV NODE_ENV development
USER intel
WORKDIR /app
COPY --chown=intel:intel package*.json ./
RUN npm install

FROM base AS builder
ARG SERVER_IP=localhost
ARG LLM_IP=backend
ARG STT_IP=localhost
ARG TTS_IP=localhost
ARG SERVER_PORT=8011
ARG LLM_PORT=8011
ARG STT_PORT=8013
ARG TTS_PORT=8014
ENV NEXT_PUBLIC_API_URL=$SERVER_IP
ENV NEXT_PUBLIC_API_PORT=$SERVER_PORT
ENV NEXT_PUBLIC_LLM_API_URL=$LLM_IP
ENV NEXT_PUBLIC_LLM_API_PORT=$LLM_PORT
ENV NEXT_PUBLIC_STT_API_URL=$STT_IP
ENV NEXT_PUBLIC_STT_API_PORT=$STT_PORT
ENV NEXT_PUBLIC_TTS_API_URL=$TTS_IP
ENV NEXT_PUBLIC_TTS_API_PORT=$TTS_PORT

USER intel
WORKDIR /app
COPY --chown=intel:intel package*.json ./
RUN npm install
COPY --chown=intel:intel . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV production
USER intel
WORKDIR /app
COPY --from=builder --chown=intel:intel /app/public ./public
COPY --from=builder --chown=intel:intel /app/package*.json ./
COPY --from=builder --chown=intel:intel /app/.next ./.next
RUN npm install --production

CMD ["npm", "start"]