FROM robotics-ai-suite:humanoid-imitation-learning-base
ENV DEBIAN_FRONTEND=noninteractive
ENV SAMPLE_NAME=pi05-rtc-ov

USER root

COPY --chown=ubuntu:ubuntu scripts/install_dependencies.sh /app/edge-ai-suites/robotics-ai-suite/install_dependencies.sh
COPY --chown=ubuntu:ubuntu scripts/launch_sample.sh /app/edge-ai-suites/robotics-ai-suite/launch_sample.sh

RUN chmod +x /app/edge-ai-suites/robotics-ai-suite/install_dependencies.sh \
    && chmod +x /app/edge-ai-suites/robotics-ai-suite/launch_sample.sh

USER ubuntu
WORKDIR /app/edge-ai-suites/robotics-ai-suite

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python3 --version >/dev/null 2>&1 || exit 1