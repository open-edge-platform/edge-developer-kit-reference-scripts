# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

FROM debian:12-slim

ARG DEBIAN_FRONTEND=noninteractive
ARG RENDER_GROUP_ID
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install --no-install-recommends -y \
    sudo \
    wget \
    ca-certificates \
    ffmpeg \
    libsm6 \
    libxext6 \
    curl \
    espeak-ng \
    && rm -rf /var/lib/apt/lists/* 

RUN apt-get update && apt-get install --no-install-recommends python3 python3-venv python3-pip -y

RUN addgroup --system intel --gid 1000 \
    && adduser --system --ingroup intel --uid 1000 --home /home/intel intel \
    && echo "intel ALL=(ALL:ALL) NOPASSWD:ALL" > /etc/sudoers.d/intel \
    && mkdir -p /usr/src \
    && chown -R intel:intel /usr/src

USER intel
WORKDIR /usr/src/app

RUN python3 -m venv /usr/src/.venv
ENV PATH="/usr/src/.venv/bin:$PATH"

COPY --chown=intel . .
RUN python3 -m pip install -r requirements.txt

HEALTHCHECK --interval=30s --timeout=180s --start-period=60s --retries=3 \
    CMD sh -c 'PORT=${SERVER_PORT:-8013} && wget --no-verbose -O /dev/null --tries=1 http://localhost:$PORT/healthcheck || exit 1'