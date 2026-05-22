# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

FROM openvino/ubuntu24_dev:2024.6.0
ARG DEBIAN_FRONTEND=noninteractive
ARG VLLM_VERSION=v0.6.6
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

USER root
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install --no-install-recommends -y \
        sudo \
        curl \
        git \
        gpg-agent \
        software-properties-common \
        python3 \
        python3-venv \
    && add-apt-repository -y ppa:kobuk-team/intel-graphics \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        libze-intel-gpu1 \
        libze1 \
        intel-metrics-discovery \
        intel-opencl-icd \
        clinfo \
        intel-gsc \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/src/app/data \
    && chown -R openvino:openvino /usr/src

USER openvino
WORKDIR /usr/src/app
RUN python3 -m venv /usr/src/.venv \
    && git clone https://github.com/vllm-project/vllm.git
ENV PATH="/usr/src/.venv/bin:$PATH"

WORKDIR /usr/src/app/vllm
RUN git checkout ${VLLM_VERSION} \
    && python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements-build.txt
COPY --chown=openvino:openvino patch/openvino.txt requirements-openvino.txt
RUN VLLM_TARGET_DEVICE="openvino" python3 -m pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu .

WORKDIR /usr/src/app
RUN opt_in_out --opt_out
COPY --chown=openvino:openvino entrypoint.sh /usr/src/app/entrypoint.sh
RUN chmod +x /usr/src/app/entrypoint.sh

HEALTHCHECK --interval=1m --timeout=30s --start-period=5s --retries=10 \
    CMD curl -f http://localhost:8000/health || exit 1

ENTRYPOINT [ "/usr/src/app/entrypoint.sh" ]