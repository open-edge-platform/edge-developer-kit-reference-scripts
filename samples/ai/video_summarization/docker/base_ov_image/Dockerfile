# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

#FROM intel/oneapi-basekit:2025.0.2-0-devel-ubuntu24.04
#FROM intel/oneapi-basekit:2025.0.1-0-devel-ubuntu22.04 AS build
#ARG IPEX_LLM_VERSION=2.2.0b20250319
FROM ubuntu:24.04
ARG DEBIAN_FRONTEND=noninteractive

ARG PIP_NO_CACHE_DIR=false
ARG RENDER_GROUP_ID
ARG USER_UID=1001
ARG USER_GID=1000
ARG USER_NAME=intel

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

ENV HTTP_PROXY=$HTTP_PROXY
ENV HTTPS_PROXY=$HTTPS_PROXY
ENV NO_PROXY=$NO_PROXY


RUN apt update && \
    apt install -y curl software-properties-common git sudo
    
# Set environment variables
ENV TZ=Asia/Shanghai PYTHONUNBUFFERED=1

#WORKDIR /opt/intel/llm-app

RUN useradd -m -u ${USER_UID} -g ${USER_GID} -s /bin/bash ${USER_NAME} \
    && echo "intel ALL=(ALL:ALL) NOPASSWD:ALL" > /etc/sudoers.d/intel \
    && groupadd -g ${RENDER_GROUP_ID} render \
    && usermod -aG render  ${USER_NAME} \
    && mkdir -p /usr/src \
    && chown -R 1001:1000 /usr/src

RUN apt update \
    && apt install -y python3-full python3-venv \
        python3-pip \
        python3-apt \
        libncurses-dev \
        libffi-dev \
        libssl-dev \
        libbz2-dev \
        liblzma-dev \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv .venv

RUN set -eux && \
    # Set timezone
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone && \
    # 
    # Install Python 3.11
    #add-apt-repository ppa:deadsnakes/ppa -y && \
    add-apt-repository -y ppa:kobuk-team/intel-graphics && \
    apt-get install --no-install-recommends -y libze-intel-gpu1 libze1 intel-ocloc intel-opencl-icd clinfo intel-gsc intel-media-va-driver-non-free libmfx1 libmfx-gen1 libvpl2 libvpl-tools libva-glx2 va-driver-all vainfo
 
USER ${USER_NAME}
ENV PYENV_ROOT="/usr/src/app/.pyenv"
ENV PATH="$PYENV_ROOT/versions/3.10.15/bin:$PYENV_ROOT/shims:$PYENV_ROOT/bin:$PATH"

RUN curl https://pyenv.run | bash \
  && pyenv install 3.11.12 \
  && pyenv global 3.11.12


WORKDIR /usr/src/app
COPY ./ ./
RUN mkdir -p /usr/src/app/chunks \
     && mkdir -p /usr/src/app/.cache \
     && mkdir -p ~/.cache/clip 


RUN set -eux && \
    python3 -m pip install --upgrade pip && \
    #
    # Install Intel PyTorch extension for LLM inference
    python3 -m pip install --pre --upgrade openvino==2026.0.0 openvino-genai==2026.0.0 openvino-tokenizers==2026.0.0 && \    
    python3 -m pip install transformers==4.46.0 ffmpeg-python==0.2.0 opencv-python langchain-community langchain langchain-vdms numpy==1.26.4 Pillow && \
    python3 -m pip install streamlit==1.37.0 streamlit_webrtc uvicorn==0.34.3 decord fastapi ftfy einops httpx requests tzlocal torch torchvision torchaudio dateparser

RUN set -eux && \
    curl -o ~/.cache/clip/ViT-B-32.pt https://openaipublic.azureedge.net/clip/models/40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af/ViT-B-32.pt && \
    curl -o ~/.cache/clip/ViT-B-16.pt https://openaipublic.azureedge.net/clip/models/5806e77cd80f8b59890b7e101eabd078d9fb84e6937f9e85e4ecb61988df416f/ViT-B-16.pt

HEALTHCHECK CMD true

CMD bash
