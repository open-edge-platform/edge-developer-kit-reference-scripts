FROM robotics-ai-suite:autonomous-mobile-robot-base
ENV DEBIAN_FRONTEND=noninteractive
ENV SAMPLE_NAME=collaborative-visual-slam

USER root
RUN apt update \
    && apt install -y ros-jazzy-collab-slam-lze \
        ros-jazzy-cslam-tutorial-two-robot \
        ros-jazzy-cslam-tutorial-fastmapping \
        ros-jazzy-cslam-tutorial-multi-camera \
        ros-jazzy-cslam-tutorial-2d-lidar \
        ros-jazzy-cslam-tutorial-region-remap \
    && rm -rf /var/lib/apt/lists/*

USER ubuntu
WORKDIR /app/edge-ai-suites/robotics-ai-suite

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ros2 --help >/dev/null 2>&1 || exit 1