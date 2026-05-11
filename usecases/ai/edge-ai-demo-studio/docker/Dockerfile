FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

ARG USER=ubuntu

COPY ./install_dependencies.sh /home/ubuntu/install_dependencies.sh

RUN chmod +x /home/ubuntu/install_dependencies.sh

# Setup sudo for ubuntu user
RUN apt-get update && apt-get install -y sudo && \
  usermod -aG sudo ${USER} && \
  echo "${USER} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USER} && \
  chmod 0440 /etc/sudoers.d/${USER} && \
  echo 'Defaults env_keep += "http_proxy https_proxy HTTP_PROXY HTTPS_PROXY no_proxy NO_PROXY ftp_proxy FTP_PROXY"' > /etc/sudoers.d/proxy_env && \
  chmod 0440 /etc/sudoers.d/proxy_env

USER ${USER}

# Mock clinfo to simulate Intel GPU presence
# Install into /usr/local/bin so it is always on the secure_path ahead of /usr/bin
RUN sudo printf '%s\n' \
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
  'fi' | sudo tee /usr/local/bin/clinfo > /dev/null && sudo chmod +x /usr/local/bin/clinfo

# Mock hardware and run install dependencies as ubuntu user
RUN sudo mkdir -p /dev/dri && \
    sudo touch /dev/dri/renderD128 /dev/dri/card0 && \
    sudo chmod 666 /dev/dri/* && \
    sudo -E /home/ubuntu/install_dependencies.sh -y && \
    sudo rm -rf /dev/dri && \
    sudo rm -f /usr/local/bin/clinfo

COPY . /home/ubuntu
RUN sudo chown -R ${USER}:${USER} /home/ubuntu
RUN sudo rm -f /etc/sudoers.d/${USER}

WORKDIR /home/ubuntu

RUN ./setup.sh --verbose

USER ${USER}

CMD ["/bin/bash", "-c", "cd /home/ubuntu && ./start.sh"]