FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

ARG USER=ubuntu

COPY ./install_dependencies.sh /home/ubuntu/install_dependencies.sh

RUN chmod +x /home/ubuntu/install_dependencies.sh

# Setup sudo for ubuntu user (sudo is required by install_dependencies.sh)
RUN apt-get update && apt-get install -y --no-install-recommends sudo && \
  rm -rf /var/lib/apt/lists/* && \
  usermod -aG sudo ${USER} && \
  echo "${USER} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USER} && \
  chmod 0440 /etc/sudoers.d/${USER} && \
  echo 'Defaults env_keep += "http_proxy https_proxy HTTP_PROXY HTTPS_PROXY no_proxy NO_PROXY ftp_proxy FTP_PROXY"' > /etc/sudoers.d/proxy_env && \
  chmod 0440 /etc/sudoers.d/proxy_env

# Mock clinfo to simulate Intel GPU presence
# Install into /usr/local/bin so it is always on the secure_path ahead of /usr/bin
RUN printf '%s\n' \
  '#!/bin/sh' \
  '# Check if the script is asking for device enumeration' \
  'if echo "$*" | grep -q "\-l"; then' \
  '  echo "Platform #0: Intel(R) OpenCL HD Graphics"' \
  '  echo " \`-- Device #0: Intel(R) UHD Graphics"' \
  'else' \
  '  # If the real clinfo exists, pass other calls to it, else just exit 0' \
  '  if [ -x /usr/bin/clinfo ]; then' \
  '    exec /usr/bin/clinfo "$@"' \
  '  fi' \
  '  exit 0' \
  'fi' > /usr/local/bin/clinfo && chmod +x /usr/local/bin/clinfo

RUN printf '%s\n' '#!/bin/sh' 'exit 0' > /usr/local/bin/rmmod && \
    chmod +x /usr/local/bin/rmmod && \
    printf '%s\n' '#!/bin/sh' 'exit 0' > /usr/local/bin/modprobe && \
    chmod +x /usr/local/bin/modprobe

# Mock hardware and run install dependencies
RUN mkdir -p /dev/dri && \
    touch /dev/dri/renderD128 /dev/dri/card0 && \
    chmod 666 /dev/dri/* && \
    /home/ubuntu/install_dependencies.sh -y && \
    rm -rf /dev/dri && \
    rm -f /usr/local/bin/clinfo /usr/local/bin/rmmod /usr/local/bin/modprobe

COPY . /home/ubuntu
RUN chown -R ${USER}:${USER} /home/ubuntu && \
    rm -f /etc/sudoers.d/${USER}
    
WORKDIR /home/ubuntu

USER ${USER}

# Default llama.cpp build for the multiserve engine: sycl or vulkan. Passed
# explicitly so the .llamacpp-backend of the checkout the image is built from does
# not decide. The image ships both builds; LLAMACPP_BACKEND at run time switches.
ARG LLAMACPP_BACKEND=sycl

RUN ./setup.sh --verbose --backend ${LLAMACPP_BACKEND}
# Add the other backend's llama.cpp build next to it, then restore the selection
# setup.sh saved, so docker/start-container.sh can switch without a download.
RUN bash -c 'set -euo pipefail; \
      . scripts/bash/llamacpp_backend.sh; \
      case "$LLAMACPP_BACKEND" in sycl) other=vulkan ;; *) other=sycl ;; esac; \
      cp "$LLAMACPP_BACKEND_CONFIG_FILE" /tmp/llamacpp-backend; \
      lb_save_config "$other"; \
      cd workers/engines/multiserve; \
      UV_PATH=/home/ubuntu/workers/thirdparty/uv/uv LLAMACPP_KEEP_OTHER_BUILD=true ./setup.sh; \
      mv /tmp/llamacpp-backend "$LLAMACPP_BACKEND_CONFIG_FILE"'
RUN mkdir -p /home/ubuntu/models
RUN mkdir -p /home/ubuntu/logs
RUN mkdir -p /home/ubuntu/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD test -x /home/ubuntu/start.sh || exit 1

CMD ["/bin/bash", "/home/ubuntu/docker/start-container.sh"]