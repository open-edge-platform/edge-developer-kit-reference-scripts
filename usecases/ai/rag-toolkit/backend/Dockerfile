# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

FROM debian:12-slim
ARG DEBIAN_FRONTEND=noninteractive
ARG OPENVINO_VERSION=2025.3.0
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

USER root

# Install dependencies
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install --no-install-recommends -y \
        sudo \
        curl \
        git \
        gpg-agent \
        software-properties-common \
        libmagic1 \
        python3 \
        python3-venv \
    && curl -fsSL https://repositories.intel.com/gpu/intel-graphics.key | gpg --dearmor | tee /usr/share/keyrings/intel-graphics.gpg \
    && echo "deb [arch=amd64,i386 signed-by=/usr/share/keyrings/intel-graphics.gpg] https://repositories.intel.com/gpu/ubuntu jammy client" > /etc/apt/sources.list.d/intel-graphics.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        intel-opencl-icd \
        intel-level-zero-gpu \
        libze1 \
        libze-dev \
        clinfo \
        libtbb12 \
    && addgroup --system intel --gid 1000 \
    && adduser --system --ingroup intel --uid 1000 --home /home/intel intel \
    && echo "intel ALL=(ALL:ALL) NOPASSWD:ALL" > /etc/sudoers.d/intel \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/src/app/data \
    && chown -R intel:intel /usr/src

# Install NPU drivers
WORKDIR /tmp/npu-driver
RUN curl -LO https://github.com/intel/linux-npu-driver/releases/download/v1.17.0/intel-driver-compiler-npu_1.17.0.20250508-14912879441_ubuntu22.04_amd64.deb \
    && curl -LO https://github.com/intel/linux-npu-driver/releases/download/v1.17.0/intel-fw-npu_1.17.0.20250508-14912879441_ubuntu22.04_amd64.deb \
    && curl -LO https://github.com/intel/linux-npu-driver/releases/download/v1.17.0/intel-level-zero-npu_1.17.0.20250508-14912879441_ubuntu22.04_amd64.deb \
    && curl -LO https://github.com/oneapi-src/level-zero/releases/download/v1.21.9/level-zero_1.21.9+u22.04_amd64.deb \
    && dpkg -i *.deb

USER intel
WORKDIR /usr/src/app

RUN mkdir -p /usr/src \
    && chown -R intel:intel /usr/src \
    && mkdir -p /usr/src/app/data \
    && chown -R intel:intel /usr/src/app/data

WORKDIR /usr/src/app
RUN python3 -m venv /usr/src/.venv 
ENV PATH="/usr/src/.venv/bin:$PATH"

# Install python dependencies
RUN python3 -m pip install fastapi[all] \
        sse_starlette==2.1.2 \
        scipy \
        soundfile \
        numpy==1.26.4 \
        openai==1.56.2 \
        pyyaml==6.0.1 \
        pypdf==6.0.0 \
        langchain==0.3.27 \
        langchain-chroma==0.2.5 \
        langchain-community===0.3.27 \
        chromadb==1.0.20 \
        'huggingface_hub>=0.23.0' \
        botocore==1.34.88 \
        cached_path==1.6.3 \
        python-magic
RUN python3 -m pip install --extra-index-url https://download.pytorch.org/whl/cpu \
        torch==2.8.0 \
        torchaudio==2.8.0 \
        openvino==2025.3.0 \
        optimum-intel[openvino,nncf]==1.26.1

COPY --chown=openvino:openvino backend .

EXPOSE 8011
HEALTHCHECK --interval=60s --timeout=180s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8011/healthcheck || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8011"]
