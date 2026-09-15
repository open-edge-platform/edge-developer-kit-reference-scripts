FROM python:3.12-slim

ARG INSTALL_DRIVER_VERSION="26.09.37435"
ARG NPU_DRIVER_VERSION="1.33.0"
ARG NPU_DRIVER_BUILD="v1.33.0.20260529-26625960453-ubuntu2404"
ARG LEVEL_ZERO_VERSION="1.27.0-1~24.04~ppa2"
ARG LEVEL_ZERO_PPA_SNAPSHOT="20260324T100000Z"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    espeak-ng \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Intel GPU drivers (compute-runtime + IGC) inside container
COPY setup/install_gpu_drivers.sh /tmp/install_gpu_drivers.sh
RUN chmod +x /tmp/install_gpu_drivers.sh && \
    /tmp/install_gpu_drivers.sh && \
    rm -f /tmp/install_gpu_drivers.sh

# Install Intel NPU user-space stack (level-zero loader + NPU driver)
WORKDIR /tmp/npu_deps
RUN (apt-get update || true) && apt-get install -y --no-install-recommends libtbb12 && \
    curl -L --retry 3 -O https://github.com/intel/linux-npu-driver/releases/download/v${NPU_DRIVER_VERSION}/linux-npu-driver-${NPU_DRIVER_BUILD}.tar.gz && \
    tar -xf linux-npu-driver-${NPU_DRIVER_BUILD}.tar.gz && \
    curl -L --retry 3 -O https://snapshot.ppa.launchpadcontent.net/kobuk-team/intel-graphics/ubuntu/${LEVEL_ZERO_PPA_SNAPSHOT}/pool/main/l/level-zero-loader/libze1_${LEVEL_ZERO_VERSION}_amd64.deb && \
    dpkg -i ./*.deb && \
    ldconfig && \
    test -e /usr/lib/x86_64-linux-gnu/libze_loader.so.1 && \
    apt-get purge -y curl && apt-get autoremove -y && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN rm -Rf /tmp/npu_deps

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source (models are mounted, not copied)
COPY src/ src/
COPY config.yaml .
COPY run.py .
RUN mkdir -p data models && \
    groupadd -r appuser && useradd -r -g appuser -u 1000 appuser && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 7860

# start-period is long because all pipeline models (Whisper, NLLB-1.3B, etc.)
# load synchronously at startup before the server accepts connections.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD ["python3", "-c", "import sys, urllib.request\ntry:\n    ok = urllib.request.urlopen('http://localhost:7860/api/health', timeout=5).status == 200\nexcept Exception:\n    ok = False\nsys.exit(0 if ok else 1)"]

CMD ["python3", "run.py"]
