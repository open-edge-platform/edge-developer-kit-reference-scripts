# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

FROM intel/oneapi-basekit:2025.1.1-0-devel-ubuntu24.04

RUN apt-get update && apt-get install -y --no-install-recommends software-properties-common
RUN add-apt-repository -y ppa:kobuk-team/intel-graphics

RUN apt-get install -y --no-install-recommends libze-intel-gpu1 libze1 intel-metrics-discovery intel-opencl-icd clinfo intel-gsc
RUN apt-get install -y --no-install-recommends intel-media-va-driver-non-free libmfx-gen1 libvpl2 libvpl-tools libva-glx2 va-driver-all vainfo
RUN apt-get install -y --no-install-recommends git build-essential cmake libcurl4-openssl-dev

WORKDIR /opt/intel/llm-app
RUN apt update \
    && apt install -y python3-venv \
        python3-pip \
        wget \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv .venv
 
RUN mkdir -p /home/ubuntu/.ollama \
    && chown -R ubuntu:ubuntu /home/ubuntu/.ollama \
    && chown -R ubuntu:ubuntu /opt/intel/llm-app
    
USER ubuntu
ENV PATH="/opt/intel/llm-app/.venv/bin:$PATH"
ENV LD_LIBRARY_PATH=".:$LD_LIBRARY_PATH"
RUN python3 -m pip install --upgrade pip \
    && python3 -m pip install --pre ipex_llm[cpp] --extra-index-url https://pytorch-extension.intel.com/release-whl/stable/xpu/us/ \
    && python3 -m pip install accelerate==0.33.0 \
    && init-ollama

HEALTHCHECK --interval=60s --timeout=5m --start-period=5s --retries=5 \
    CMD curl --fail http://localhost:11434 || exit 1

CMD ["./ollama", "serve"]