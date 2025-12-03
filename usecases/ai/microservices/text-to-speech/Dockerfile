# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

FROM debian:12-slim
ARG DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install --no-install-recommends -y \
        sudo \
        curl \
        git \
        gpg-agent \
        software-properties-common \
        python3.11 \
        python3.11-venv \
    && curl -fsSL https://repositories.intel.com/gpu/intel-graphics.key | gpg --dearmor | tee /usr/share/keyrings/intel-graphics.gpg \
    && echo "deb [arch=amd64,i386 signed-by=/usr/share/keyrings/intel-graphics.gpg] https://repositories.intel.com/gpu/ubuntu jammy client" > /etc/apt/sources.list.d/intel-graphics.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        intel-opencl-icd \
        intel-level-zero-gpu \
        libze1 \
        libze-dev \
        clinfo \
    && addgroup --system intel --gid 1000 \
    && adduser --system --ingroup intel --uid 1000 --home /home/intel intel \
    && echo "intel ALL=(ALL:ALL) NOPASSWD:ALL" > /etc/sudoers.d/intel \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/src \
    && chown -R intel:intel /usr/src

WORKDIR /tmp/npu-driver
RUN curl -LO https://github.com/intel/linux-npu-driver/releases/download/v1.10.0/intel-driver-compiler-npu_1.10.0.20241107-11729849322_ubuntu22.04_amd64.deb \
    && curl -LO https://github.com/intel/linux-npu-driver/releases/download/v1.10.0/intel-fw-npu_1.10.0.20241107-11729849322_ubuntu22.04_amd64.deb \
    && curl -LO https://github.com/intel/linux-npu-driver/releases/download/v1.10.0/intel-level-zero-npu_1.10.0.20241107-11729849322_ubuntu22.04_amd64.deb \
    && curl -LO https://github.com/oneapi-src/level-zero/releases/download/v1.17.6/level-zero_1.17.6+u22.04_amd64.deb \
    && apt update \
    && apt install -y libtbb12 \
    && mkdir -p /etc/udev/rules.d/ \
    && bash -c "echo 'SUBSYSTEM==\"accel\", KERNEL==\"accel*\", GROUP=\"render\", MODE=\"0660\"' > /etc/udev/rules.d/10-intel-vpu.rules" \
    && rm -rf /var/lib/apt/lists/* \
    && dpkg -i *.deb

USER intel
WORKDIR /usr/src/app
RUN python3 -m venv /usr/src/.venv
ENV PATH="/usr/src/.venv/bin:$PATH"
RUN mkdir -p /usr/src/app/data/models \
    && chown -R intel:intel /usr/src/app/data/models \
    && mkdir -p /usr/src/app/data/nltk_data \
    && chown -R intel:intel /usr/src/app/data/nltk_data

# Install Melo TTS
COPY requirements.txt .
RUN python3 -m pip install --upgrade pip \
    && python3 -m pip install git+https://github.com/zhaohb/MeloTTS-OV.git@1962eee --extra-index-url https://download.pytorch.org/whl/cpu \
    && python3 -m pip install -r requirements.txt \
    && python3 -m unidic download
    
COPY . .

ENV NLTK_DATA="/usr/src/app/data/nltk_data"
ENV HF_HOME="/usr/src/app/data/huggingface"

HEALTHCHECK --interval=30s --timeout=300s --start-period=60s --retries=10 \
    CMD curl --silent --show-error --fail http://localhost:5995/healthcheck || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5995"]
