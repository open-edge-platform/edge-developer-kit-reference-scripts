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

# Mock hardware and run install dependencies
RUN mkdir -p /dev/dri && \
    touch /dev/dri/renderD128 /dev/dri/card0 && \
    chmod 666 /dev/dri/* && \
    /home/ubuntu/install_dependencies.sh -y && \
    rm -rf /dev/dri && \
    rm -f /usr/local/bin/clinfo

COPY . /home/ubuntu
RUN chown -R ${USER}:${USER} /home/ubuntu && \
    rm -f /etc/sudoers.d/${USER}

WORKDIR /home/ubuntu

USER ${USER}

RUN ./setup.sh --verbose
RUN mkdir -p /home/ubuntu/models
RUN mkdir -p /home/ubuntu/logs
RUN mkdir -p /home/ubuntu/data

# Basic healthcheck: ensure the start script is present and executable
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD test -x /home/ubuntu/start.sh || exit 1

CMD ["/bin/bash", "-c", "cd /home/ubuntu && ./start.sh"]