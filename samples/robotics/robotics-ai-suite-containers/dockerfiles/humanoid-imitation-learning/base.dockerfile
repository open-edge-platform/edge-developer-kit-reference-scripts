FROM openvino/ubuntu24_dev:2026.2.1
ENV DEBIAN_FRONTEND=noninteractive
ENV VIRTUAL_ENV=
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ARG MODULE_VER=2026.1

# Use bash with pipefail so that failures in piped commands are not masked.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

USER root
RUN apt update \
    && apt install -y curl \
        unzip \
        cmake \
        git \
        git-lfs \
        locales \
        gnupg2 \
        ffmpeg \
        libgl-dev \
        libegl-dev \
        python3-dev \
        lsb-release \
        build-essential \
        libglib2.0-0 \
        libopenblas-dev \
        libssl-dev \
        portaudio19-dev \
        libavcodec-dev \
        libavformat-dev \
        libavutil-dev \
        libavdevice-dev \
        mesa-utils \
        libgl1-mesa-dri \
        libgl1-mesa-dev \
        libglx-mesa0 \
        libeigen3-dev \
        libxcb-cursor0 \
        libxcb-icccm4 \
        libxcb-image0 \
        libxcb-keysyms1 \
        libxcb-randr0 \
        libxcb-render-util0 \
        libxcb-shape0 \
        libxcb-shm0 \
        libxcb-sync1 \
        libxcb-xfixes0 \
        libxcb-xinerama0 \
        libxcb-xkb1 \
        libxcb-util1 \
        libxkbcommon-x11-0 \
        libsm6 \
        libice6 \
        python3-pip \
        python3-venv \
        python3-pymodbus \
        python3-tk

# Intel libraries
WORKDIR /tmp/neo
RUN apt remove -y intel-ocloc libze-intel-gpu1 intel-level-zero-gpu intel-opencl-icd \
    && curl -fLO https://github.com/intel/intel-graphics-compiler/releases/download/v2.36.3/intel-igc-core-2_2.36.3+21719_amd64.deb \
    && curl -fLO https://github.com/intel/intel-graphics-compiler/releases/download/v2.36.3/intel-igc-opencl-2_2.36.3+21719_amd64.deb \
    && curl -fLO https://github.com/intel/compute-runtime/releases/download/26.22.38646.4/intel-ocloc_26.22.38646.4-0_amd64.deb \
    && curl -fLO https://github.com/intel/compute-runtime/releases/download/26.22.38646.4/intel-opencl-icd_26.22.38646.4-0_amd64.deb \
    && curl -fLO https://github.com/intel/compute-runtime/releases/download/26.22.38646.4/libigdgmm12_22.10.0_amd64.deb \
    && curl -fLO https://github.com/intel/compute-runtime/releases/download/26.22.38646.4/libze-intel-gpu1_26.22.38646.4-0_amd64.deb \
    && dpkg -i *.deb \
    && rm -f *.deb

WORKDIR /tmp
RUN curl -fsSL https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB \
    | gpg --dearmor \
    | tee /usr/share/keyrings/oneapi-archive-keyring.gpg > /dev/null \
    && echo "deb [signed-by=/usr/share/keyrings/oneapi-archive-keyring.gpg] https://apt.repos.intel.com/oneapi all main" \
        > /etc/apt/sources.list.d/oneAPI.list \
    && printf "Package: intel-oneapi-runtime-compilers\nPin: version 2025.*\nPin-Priority: 1001\n\nPackage: intel-oneapi-runtime-dpcpp-cpp\nPin: version 2025.*\nPin-Priority: 1001\n\nPackage: intel-oneapi-runtime-opencl\nPin: version 2025.*\nPin-Priority: 1001\n" \
        > /etc/apt/preferences.d/oneapi

RUN curl -fsSL https://eci.intel.com/repos/gpg-keys/GPG-PUB-KEY-INTEL-ECI.gpg | tee /usr/share/keyrings/eci-archive-keyring.gpg > /dev/null \
    && echo "deb [signed-by=/usr/share/keyrings/eci-archive-keyring.gpg] https://eci.intel.com/repos/$(source /etc/os-release && echo $VERSION_CODENAME) isar main" | tee /etc/apt/sources.list.d/eci.list \
    && echo "deb-src [signed-by=/usr/share/keyrings/eci-archive-keyring.gpg] https://eci.intel.com/repos/$(source /etc/os-release && echo $VERSION_CODENAME) isar main" | tee -a /etc/apt/sources.list.d/eci.list

RUN git clone https://github.com/open-edge-platform/edge-ai-suites.git -b ${MODULE_VER} /app/edge-ai-suites \
    && chown -R ubuntu:ubuntu /app/edge-ai-suites

RUN curl -LsSf https://astral.sh/uv/install.sh | UV_INSTALL_DIR=/usr/local/bin sh

RUN git config --system --add safe.directory "*"

USER ubuntu
WORKDIR /app/edge-ai-suites/robotics-ai-suite

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python3 --version >/dev/null 2>&1 || exit 1
