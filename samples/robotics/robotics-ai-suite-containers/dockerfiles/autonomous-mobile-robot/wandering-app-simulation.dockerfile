FROM robotics-ai-suite:autonomous-mobile-robot-base
ENV DEBIAN_FRONTEND=noninteractive
ENV SAMPLE_NAME=wandering-app-simulation

USER root
RUN apt update \
    && apt install -y ros-jazzy-rtabmap-ros \
        ros-jazzy-wandering-gazebo-tutorial \
    && rm -rf /var/lib/apt/lists/*

USER ubuntu
WORKDIR /app/edge-ai-suites/robotics-ai-suite

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ros2 --help >/dev/null 2>&1 || exit 1