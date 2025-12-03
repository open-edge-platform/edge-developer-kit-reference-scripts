# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

FROM openvino/ubuntu22_dev:2024.6.0

USER root

# Install dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
        wget \
        gnupg2 \
        libtbb12 \
        python3.11 \
        python3.11-venv 

# Install GPU drivers
WORKDIR /tmp/neo
RUN wget https://github.com/intel/intel-graphics-compiler/releases/download/igc-1.0.17791.9/intel-igc-core_1.0.17791.9_amd64.deb \
    && wget https://github.com/intel/intel-graphics-compiler/releases/download/igc-1.0.17791.9/intel-igc-opencl_1.0.17791.9_amd64.deb \
    && wget https://github.com/intel/compute-runtime/releases/download/24.39.31294.12/intel-level-zero-gpu-dbgsym_1.6.31294.12_amd64.ddeb \
    && wget https://github.com/intel/compute-runtime/releases/download/24.39.31294.12/intel-level-zero-gpu_1.6.31294.12_amd64.deb \
    && wget https://github.com/intel/compute-runtime/releases/download/24.39.31294.12/intel-opencl-icd-dbgsym_24.39.31294.12_amd64.ddeb \
    && wget https://github.com/intel/compute-runtime/releases/download/24.39.31294.12/intel-opencl-icd_24.39.31294.12_amd64.deb \
    && wget https://github.com/intel/compute-runtime/releases/download/24.39.31294.12/libigdgmm12_22.5.2_amd64.deb \
    && dpkg -i *.deb

# Install NPU drivers
WORKDIR /tmp/npu-driver
RUN wget https://github.com/intel/linux-npu-driver/releases/download/v1.10.0/intel-driver-compiler-npu_1.10.0.20241107-11729849322_ubuntu22.04_amd64.deb \
    && wget https://github.com/intel/linux-npu-driver/releases/download/v1.10.0/intel-fw-npu_1.10.0.20241107-11729849322_ubuntu22.04_amd64.deb \
    && wget https://github.com/intel/linux-npu-driver/releases/download/v1.10.0/intel-level-zero-npu_1.10.0.20241107-11729849322_ubuntu22.04_amd64.deb \
    && wget https://github.com/oneapi-src/level-zero/releases/download/v1.17.6/level-zero_1.17.6+u22.04_amd64.deb \
    && dpkg -i *.deb

RUN mkdir -p /usr/src \
    && chown -R openvino:openvino /usr/src \
    && mkdir -p /usr/src/app/data \
    && chown -R openvino:openvino /usr/src/app/data \
    && mkdir -p /usr/src/app/tmp_audio \
    && chown -R openvino:openvino /usr/src/app/tmp_audio

USER openvino
WORKDIR /usr/src/app
RUN python3 -m venv /usr/src/.venv 
ENV PATH="/usr/src/.venv/bin:$PATH"

# Install python dependencies
COPY --chown=openvino:openvino requirements.txt .
RUN python3 -m pip install -U pip \
    && python3 -m pip install -r requirements.txt

COPY --chown=openvino:openvino main.py .
COPY --chown=openvino:openvino utils.py .

HEALTHCHECK --interval=30s --timeout=6m --start-period=5s --retries=10 \
    CMD wget --no-verbose --no-proxy -O /dev/null --tries=1 http://localhost:5996/healthcheck || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5996"]
