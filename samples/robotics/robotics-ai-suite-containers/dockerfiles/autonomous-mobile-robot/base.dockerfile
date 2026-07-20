FROM osrf/ros:jazzy-desktop
ENV DEBIAN_FRONTEND=noninteractive
ARG MODULE_VER=2026.1

# Use bash so that constructs like "source /etc/os-release" work inside RUN,
# and enable pipefail so that failures in piped commands are not masked.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

USER root

# Install base tooling required for the rest of the build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        debconf-utils \
        git \
        gnupg \
        lsb-release \
    && rm -rf /var/lib/apt/lists/*

# Install the Intel GPU compute runtime from upstream .deb packages.
WORKDIR /tmp/neo
RUN apt-get remove -y intel-ocloc libze-intel-gpu1 intel-level-zero-gpu intel-opencl-icd || true \
    && curl -fLO https://github.com/intel/intel-graphics-compiler/releases/download/v2.36.3/intel-igc-core-2_2.36.3+21719_amd64.deb \
    && curl -fLO https://github.com/intel/intel-graphics-compiler/releases/download/v2.36.3/intel-igc-opencl-2_2.36.3+21719_amd64.deb \
    && curl -fLO https://github.com/intel/compute-runtime/releases/download/26.22.38646.4/intel-ocloc_26.22.38646.4-0_amd64.deb \
    && curl -fLO https://github.com/intel/compute-runtime/releases/download/26.22.38646.4/intel-opencl-icd_26.22.38646.4-0_amd64.deb \
    && curl -fLO https://github.com/intel/compute-runtime/releases/download/26.22.38646.4/libigdgmm12_22.10.0_amd64.deb \
    && curl -fLO https://github.com/intel/compute-runtime/releases/download/26.22.38646.4/libze-intel-gpu1_26.22.38646.4-0_amd64.deb \
    && dpkg -i *.deb \
    && rm -f *.deb

# Configure all required APT repositories, keys and pin preferences.
RUN mkdir -p /etc/apt/keyrings /usr/share/keyrings \
    && curl -fsSL https://eci.intel.com/repos/gpg-keys/GPG-PUB-KEY-INTEL-ECI.gpg | tee /usr/share/keyrings/eci-archive-keyring.gpg > /dev/null \
    && echo "deb [signed-by=/usr/share/keyrings/eci-archive-keyring.gpg] https://eci.intel.com/repos/$(source /etc/os-release && echo $VERSION_CODENAME) isar main" > /etc/apt/sources.list.d/eci.list \
    && echo "deb-src [signed-by=/usr/share/keyrings/eci-archive-keyring.gpg] https://eci.intel.com/repos/$(source /etc/os-release && echo $VERSION_CODENAME) isar main" >> /etc/apt/sources.list.d/eci.list \
    && echo "deb [signed-by=/usr/share/keyrings/eci-archive-keyring.gpg] https://amrdocs.intel.com/repos/$(source /etc/os-release && echo $VERSION_CODENAME) amr main" > /etc/apt/sources.list.d/amr.list \
    && echo "deb-src [signed-by=/usr/share/keyrings/eci-archive-keyring.gpg] https://amrdocs.intel.com/repos/$(source /etc/os-release && echo $VERSION_CODENAME) amr main" >> /etc/apt/sources.list.d/amr.list \
    && printf 'Package: *\nPin: origin eci.intel.com\nPin-Priority: 1000\n' > /etc/apt/preferences.d/isar \
    && printf 'Package: *\nPin: origin amrdocs.intel.com\nPin-Priority: 1001\n' > /etc/apt/preferences.d/amr \
    && printf '\nPackage: libflann*\nPin: version 1.19.*\nPin-Priority: -1\n\nPackage: flann*\nPin: version 1.19.*\nPin-Priority: -1\n' >> /etc/apt/preferences.d/isar \
    && curl -fsSL https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB | gpg --dearmor | tee /usr/share/keyrings/oneapi-archive-keyring.gpg > /dev/null \
    && echo "deb [signed-by=/usr/share/keyrings/oneapi-archive-keyring.gpg] https://apt.repos.intel.com/oneapi all main" > /etc/apt/sources.list.d/oneAPI.list \
    && printf 'Package: intel-oneapi-runtime-*\nPin: version 2025.*\nPin-Priority: 1001\n' > /etc/apt/preferences.d/oneapi \
    && printf 'Package: intel-oneapi-compiler-*\nPin: version 2025.3.*\nPin-Priority: 1001\n' >> /etc/apt/preferences.d/oneapi \
    && printf 'Package: intel-oneapi-mkl-*\nPin: version 2025.3.*\nPin-Priority: 1001\n' >> /etc/apt/preferences.d/oneapi \
    && printf "Package: intel-oneapi-runtime-compilers\nPin: version 2025.*\nPin-Priority: 1001\n\nPackage: intel-oneapi-runtime-dpcpp-cpp\nPin: version 2025.*\nPin-Priority: 1001\n\nPackage: intel-oneapi-runtime-opencl\nPin: version 2025.*\nPin-Priority: 1001\n" >> /etc/apt/preferences.d/oneapi \
    && curl -sSf https://librealsense.realsenseai.com/Debian/librealsenseai.asc | gpg --dearmor | tee /etc/apt/keyrings/librealsenseai.gpg > /dev/null \
    && echo "deb [signed-by=/etc/apt/keyrings/librealsenseai.gpg] https://librealsense.realsenseai.com/Debian/apt-repo $(lsb_release -cs) main" > /etc/apt/sources.list.d/librealsense.list \
    && curl -fsSL https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB | gpg --dearmor | tee /etc/apt/trusted.gpg.d/intel.gpg > /dev/null \
    && echo "deb https://apt.repos.intel.com/openvino ubuntu24 main" > /etc/apt/sources.list.d/intel-openvino.list \
    && echo -e "\nPackage: openvino-libraries-dev\nPin: version 2025.3.0*\nPin-Priority: 1001" | sudo tee /etc/apt/preferences.d/intel-openvino \
    && echo -e "\nPackage: openvino\nPin: version 2025.3.0*\nPin-Priority: 1001" | sudo tee -a /etc/apt/preferences.d/intel-openvino \
    && echo -e "\nPackage: ros-jazzy-openvino-wrapper-lib\nPin: version 2025.3.0*\nPin-Priority: 1002" | sudo tee -a /etc/apt/preferences.d/intel-openvino \
    && echo -e "\nPackage: ros-jazzy-openvino-node\nPin: version 2025.3.0*\nPin-Priority: 1002" | sudo tee -a /etc/apt/preferences.d/intel-openvino \
    && curl -sSL https://packages.osrfoundation.org/gazebo.gpg -o /usr/share/keyrings/pkgs-osrf-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/pkgs-osrf-archive-keyring.gpg] https://packages.osrfoundation.org/gazebo/ubuntu-stable $(lsb_release -cs) main" > /etc/apt/sources.list.d/gazebo-stable.list

# Install the packages provided by the repositories configured above.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpcl-dev \
        gz-harmonic \
        openvino \
        librealsense2 \
        librealsense2-dkms \
        ros-jazzy-robotics-sdk \
        ros-jazzy-openvino-node \
        ros-jazzy-librealsense2 \
        intel-oneapi-runtime-mkl \
        intel-oneapi-runtime-compilers \
        intel-oneapi-runtime-opencl \
        intel-oneapi-runtime-dpcpp-cpp \
        intel-oneapi-runtime-dpcpp-sycl-core=2025.3.3-30 \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/open-edge-platform/edge-ai-suites.git -b ${MODULE_VER} /app/edge-ai-suites \
    && chown -R ubuntu:ubuntu /app/edge-ai-suites

USER ubuntu
WORKDIR /app/edge-ai-suites/robotics-ai-suite

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ros2 --help >/dev/null 2>&1 || exit 1
