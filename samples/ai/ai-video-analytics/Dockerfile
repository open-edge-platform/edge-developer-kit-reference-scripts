# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

FROM debian:12-slim 
ARG DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install --no-install-recommends -y \
    sudo \
    wget \
    curl \
    gnupg2 \
    python3.11 \
    python3.11-venv \
    libgl1-mesa-dev \
    libglib2.0-0 \
    libmagic1 \
    && addgroup --system intel --gid 1000 \
    && adduser --system --ingroup intel --uid 1000 --home /home/intel intel \
    && echo "intel ALL=(ALL:ALL) NOPASSWD:ALL" > /etc/sudoers.d/intel \
    && addgroup --system docker --gid 999 \
    && usermod -aG docker intel \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/src \
    && chown -R intel:intel /usr/src

RUN wget -qO - https://repositories.intel.com/gpu/intel-graphics.key | \
    gpg --yes --dearmor --output /usr/share/keyrings/intel-graphics.gpg
RUN echo "deb [arch=amd64,i386 signed-by=/usr/share/keyrings/intel-graphics.gpg] https://repositories.intel.com/gpu/ubuntu jammy client" | \
    tee /etc/apt/sources.list.d/intel-gpu-jammy.list
RUN apt-get update \
    && apt-get install --no-install-recommends -y libze1 intel-level-zero-gpu intel-opencl-icd clinfo


USER intel
WORKDIR /usr/src/app
COPY --chown=intel:intel ./ /usr/src/app
RUN python3 -m venv /usr/src/.venv
ENV PATH="/usr/src/.venv/bin:$PATH"
RUN python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir gradio==5.11.0 \
    pydantic==2.10.6 \
    openvino-dev==2024.4.0 \
    nncf==2.13.0 \
    optimum==1.22.0 \
    optimum-intel==1.19.0 \
    langchain==0.3.3 \
    langchain-community==0.3.2 \
    langchain-chroma==0.1.4 \
    chromadb==0.5.12 \
    transformers==4.44.2 \
    sentence-transformers==3.1.1 \
    pandas==2.2.3 \
    ultralytics==8.3.9 \
    openai-clip==1.0.1 \
    moviepy==1.0.3 \
    opencv-python==4.10.0.84 \
    python-magic==0.4.27 \ 
    posthog==5.4.0
RUN python3 -m pip install --no-cache-dir --extra-index-url https://pytorch-extension.intel.com/release-whl/stable/cpu/us/ \
    torch==2.4.1 \
    torchvision==0.19.1
RUN mkdir -p ./data/model/facial_recognition
RUN wget -O ./data/model/facial_recognition/face-detection-retail-0004.xml https://storage.openvinotoolkit.org/repositories/open_model_zoo/2023.0/models_bin/1/face-detection-retail-0004/FP32/face-detection-retail-0004.xml
RUN wget -O ./data/model/facial_recognition/face-detection-retail-0004.bin https://storage.openvinotoolkit.org/repositories/open_model_zoo/2023.0/models_bin/1/face-detection-retail-0004/FP32/face-detection-retail-0004.bin
RUN wget -O ./data/model/facial_recognition/landmarks-regression-retail-0009.xml https://storage.openvinotoolkit.org/repositories/open_model_zoo/2023.0/models_bin/1/landmarks-regression-retail-0009/FP32/landmarks-regression-retail-0009.xml
RUN wget -O ./data/model/facial_recognition/landmarks-regression-retail-0009.bin https://storage.openvinotoolkit.org/repositories/open_model_zoo/2023.0/models_bin/1/landmarks-regression-retail-0009/FP32/landmarks-regression-retail-0009.bin

EXPOSE 5980

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -I --fail http://localhost:5980/ || exit 1

CMD ["python", "app.py"]
