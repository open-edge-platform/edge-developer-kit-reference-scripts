# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

FROM ubuntu:24.04

# Update package list and install dependencies
RUN apt update && apt upgrade -y && apt install -y \
    build-essential \
    cmake \
    git \
    msr-tools \
    vim \
    sudo

# Create a non-root user and group
RUN groupadd -r rtuser && useradd -r -g rtuser rtuser
RUN usermod -aG sudo rtuser

# Set the working directory
WORKDIR /home/rtuser

# Change ownership of the working directory to the non-root user
RUN chown -R rtuser:rtuser /home/rtuser

# Switch to the non-root user
USER rtuser

# Clone the cJSON repository
RUN git clone https://github.com/DaveGamble/cJSON.git

# Set the working directory to cJSON
WORKDIR /home/rtuser/cJSON

# Build the cJSON library
RUN mkdir build
WORKDIR /home/rtuser/cJSON/build
RUN cmake ..
RUN make

# Switch back to root to install the library system-wide
USER root
RUN make install && ldconfig

# Switch back to the non-root user
USER rtuser

# Clone the paho.mqtt.c repository
WORKDIR /home/rtuser
RUN git clone https://github.com/eclipse/paho.mqtt.c.git

# Set the working directory to paho.mqtt.c
WORKDIR /home/rtuser/paho.mqtt.c

# Build the paho.mqtt.c library
RUN mkdir build
WORKDIR /home/rtuser/paho.mqtt.c/build
RUN cmake ..
RUN make

# Switch back to root to install the library system-wide
USER root
RUN make install && ldconfig

# Switch back to the non-root user
USER rtuser

# Clone the edge-developer-kit-reference-scripts repository
WORKDIR /home/rtuser
RUN git clone https://github.com/intel/edge-developer-kit-reference-scripts.git

# Set the working directory for the non-root user
WORKDIR /home/rtuser/edge-developer-kit-reference-scripts/usecases/real-time/tcc_tutorial

# Build the project
RUN make

# Give execute permissions to the file
RUN chmod +x rt_linux_tutorial

# Allow root privilige to app and scripts
USER root
RUN echo "rtuser ALL=(ALL) NOPASSWD: /home/rtuser/edge-developer-kit-reference-scripts/usecases/real-time/tcc_tutorial/rt_linux_tutorial" >> /etc/sudoers
RUN echo "rtuser ALL=(ALL) NOPASSWD: /home/rtuser/edge-developer-kit-reference-scripts/usecases/real-time/tcc_tutorial/setCacheAllocation.sh" >> /etc/sudoers
RUN echo "rtuser ALL=(ALL) NOPASSWD: /home/rtuser/edge-developer-kit-reference-scripts/usecases/real-time/tcc_tutorial/setCoreFrequency.sh" >> /etc/sudoers
USER rtuser

# Healthcheck
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD npm --version || exit 1