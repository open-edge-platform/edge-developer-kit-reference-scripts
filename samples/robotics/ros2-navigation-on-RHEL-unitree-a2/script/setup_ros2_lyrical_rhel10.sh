#!/usr/bin/env bash
# Install ROS 2 Lyrical and the requested local-navigation stack on RHEL 10.
#
# Run as a normal sudo-capable user.  This script deliberately does not run
# rosdep: every required RPM is listed explicitly below.
#
# Expected repository layout after cloning this project:
#   robot_ws/
#   ├── src/       # local Unitree source plus ROS repositories cloned by this script
#   ├── patches/   # patches applied after all ROS repositories are present
#   │   ├── ceres.patch     # applied to the temporary Ceres checkout
#   │   ├── nav2.patch      # traditional diff applied to src/navigation2-1.5.0
#   │   ├── ydlidar.patch   # applied to src/ydlidar_ros2_driver
#   │   └── velodyne.patch  # applied to src/velodyne
#   └── script/    # this file
#
# Run this script from any directory; its paths are derived from its own location.
# Optional configuration:
#   REFRESH_SOURCE_LOCK=1 ./setup_ros2_lyrical_rhel10.sh
#
# On the first run, Git branch heads are resolved to 40-character commit IDs
# and recorded in ../sources.lock. Keep that file with the workspace to make
# later installations use exactly the same sources. REFRESH_SOURCE_LOCK=1
# deliberately resolves branch heads again and rewrites their entries.

set -Eeuo pipefail
IFS=$'\n\t'

ROS_DISTRO=lyrical
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
WORKSPACE="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
SRC_DIR="$WORKSPACE/src"
PATCH_DIR="$WORKSPACE/patches"
SOURCE_LOCK_FILE="$WORKSPACE/sources.lock"
TEMP_ROOT=""

YDLIDAR_SDK_BRANCH="${YDLIDAR_SDK_BRANCH:-master}"
YDLIDAR_ROS2_BRANCH="${YDLIDAR_ROS2_BRANCH:-humble}"
VELODYNE_BRANCH="${VELODYNE_BRANCH:-ros2}"
# This is the exact source commit used to create patches/velodyne.patch.
VELODYNE_COMMIT="${VELODYNE_COMMIT:-56fc178d2dad4b6d38c6a69aeb2435ff75503e52}"
SLAM_TOOLBOX_BRANCH="${SLAM_TOOLBOX_BRANCH:-lyrical}"
ROBOT_LOCALIZATION_BRANCH="${ROBOT_LOCALIZATION_BRANCH:-rolling-devel}"
NAV2_VERSION="${NAV2_VERSION:-1.5.0}"
NAV2_SIM_BRANCH="${NAV2_SIM_BRANCH:-lyrical}"
CYCLONEDDS_BRANCH="${CYCLONEDDS_BRANCH:-releases/0.10.x}"
RMW_CYCLONEDDS_BRANCH="${RMW_CYCLONEDDS_BRANCH:-lyrical}"
CERES_BRANCH="${CERES_BRANCH:-master}"
GEOGRAPHICLIB_BRANCH="${GEOGRAPHICLIB_BRANCH:-main}"
OMPL_VERSION="${OMPL_VERSION:-2.0.1}"
REFRESH_SOURCE_LOCK="${REFRESH_SOURCE_LOCK:-0}"
CYCLONEDDS_INTERFACE=""

log() {
  printf '\n==> %s\n' "$*"
}

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

on_error() {
  local exit_code=$?
  printf '\nERROR: setup stopped at line %s (exit %s).\n' "$1" "$exit_code" >&2
  if [[ -n "$TEMP_ROOT" && -d "$TEMP_ROOT" ]]; then
    printf 'Temporary build files were preserved at: %s\n' "$TEMP_ROOT" >&2
  fi
  exit "$exit_code"
}
trap 'on_error $LINENO' ERR

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

retry() {
  local maximum_attempts=$1 attempt=1 exit_code
  shift

  until "$@"; do
    exit_code=$?
    if (( attempt >= maximum_attempts )); then
      return "$exit_code"
    fi
    printf '\n==> Command failed (attempt %s/%s); retrying in %s seconds\n' \
      "$attempt" "$maximum_attempts" "$((attempt * 5))" >&2
    sleep "$((attempt * 5))"
    ((attempt += 1))
  done
}

require_rhel10() {
  local rhel_major arch
  require_command rpm
  rhel_major="$(rpm -E %rhel)"
  arch="$(uname -m)"
  [[ "$rhel_major" == "10" ]] || die "This script supports RHEL 10; detected RHEL $rhel_major."
  [[ "$arch" == "x86_64" ]] || die "This script supports x86_64; detected $arch."
}

enable_repositories() {
  local arch rhel_major crb_repo
  rhel_major="$(rpm -E %rhel)"
  arch="$(uname -m)"
  crb_repo="codeready-builder-for-rhel-${rhel_major}-${arch}-rpms"

  log "Installing locale support and repository tools"
  sudo dnf install -y langpacks-en glibc-langpack-en dnf-plugins-core curl
  sudo localectl set-locale LANG=en_US.UTF-8

  log "Enabling the RHEL CodeReady Builder repository"
  require_command subscription-manager
  sudo subscription-manager repos --enable="$crb_repo"

  log "Installing EPEL ${rhel_major}"
  sudo dnf install -y \
    "https://dl.fedoraproject.org/pub/epel/epel-release-latest-${rhel_major}.noarch.rpm"
}

install_ros_repository() {
  local release_url ros_source_version rpm_file release_metadata
  log "Installing the ROS RPM repository configuration"
  release_metadata="$TEMP_ROOT/ros-apt-source-release.json"
  retry 5 curl -fsSL --retry 3 --retry-all-errors --connect-timeout 30 \
    -o "$release_metadata" \
    https://api.github.com/repos/ros-infrastructure/ros-apt-source/releases/latest
  ros_source_version="$(awk -F'"' '/"tag_name"/ { print $4; exit }' "$release_metadata")"
  [[ -n "$ros_source_version" ]] || die "Could not determine the latest ROS repository RPM version."

  release_url="https://github.com/ros-infrastructure/ros-apt-source/releases/download/${ros_source_version}/ros2-release-${ros_source_version}-1.noarch.rpm"
  rpm_file="$TEMP_ROOT/ros2-release.rpm"
  retry 5 curl -fL --retry 3 --retry-all-errors --connect-timeout 30 \
    -o "$rpm_file" "$release_url"
  sudo dnf install -y "$rpm_file"
}

install_rpms() {
  log "Updating RHEL packages"
  sudo dnf update -y

  log "Installing ROS 2 and all explicit build dependencies (no rosdep)"
  sudo dnf install -y \
    cmake \
    gcc-c++ \
    git \
    make \
    patch \
    tar \
    unzip \
    wget \
    python3-colcon-common-extensions \
    python3-mypy \
    python3-pip \
    python3-pytest \
    python3-pytest-repeat \
    python3-pytest-rerunfailures \
    python3-setuptools \
    python3-vcstool \
    pcl \
    pcl-devel \
    gtest-devel \
    libpcap \
    libpcap-devel \
    tbb-devel \
    suitesparse \
    suitesparse-devel \
    blas-devel \
    lapack-devel \
    abseil-cpp-devel \
    google-benchmark-devel \
    glog-devel \
    gflags-devel \
    GraphicsMagick-c++-devel \
    qt6-qtscxml-devel \
    "ros-${ROS_DISTRO}-ros-base" \
    "ros-${ROS_DISTRO}-ament-cmake-libraries" \
    "ros-${ROS_DISTRO}-ament-cmake-export-definitions" \
    "ros-${ROS_DISTRO}-ament-cmake-test" \
    "ros-${ROS_DISTRO}-ament-cmake-export-dependencies" \
    "ros-${ROS_DISTRO}-ament-cmake-export-include-directories" \
    "ros-${ROS_DISTRO}-ament-cmake-export-libraries" \
    "ros-${ROS_DISTRO}-ament-cmake-export-link-flags" \
    "ros-${ROS_DISTRO}-ament-cmake-export-targets" \
    "ros-${ROS_DISTRO}-ament-cmake-gen-version-h" \
    "ros-${ROS_DISTRO}-ament-cmake-python" \
    "ros-${ROS_DISTRO}-ament-cmake-target-dependencies" \
    "ros-${ROS_DISTRO}-ament-cmake-version" \
    "ros-${ROS_DISTRO}-ament-cmake-ros-core" \
    "ros-${ROS_DISTRO}-rosidl-core-generators" \
    "ros-${ROS_DISTRO}-rosidl-generator-dds-idl" \
    "ros-${ROS_DISTRO}-rmw-dds-common" \
    "ros-${ROS_DISTRO}-ament-cppcheck" \
    "ros-${ROS_DISTRO}-ament-cpplint" \
    "ros-${ROS_DISTRO}-ament-flake8" \
    "ros-${ROS_DISTRO}-ament-lint-cmake" \
    "ros-${ROS_DISTRO}-ament-pep257" \
    "ros-${ROS_DISTRO}-ament-uncrustify" \
    "ros-${ROS_DISTRO}-ament-xmllint" \
    "ros-${ROS_DISTRO}-ament-mypy" \
    "ros-${ROS_DISTRO}-diagnostic-updater" \
    "ros-${ROS_DISTRO}-angles" \
    "ros-${ROS_DISTRO}-orocos-kdl-vendor" \
    "ros-${ROS_DISTRO}-bondcpp" \
    "ros-${ROS_DISTRO}-rviz-common" \
    "ros-${ROS_DISTRO}-rviz-default-plugins" \
    "ros-${ROS_DISTRO}-backward-ros" \
    "ros-${ROS_DISTRO}-geographic-msgs" \
    "ros-${ROS_DISTRO}-test-msgs" \
    "ros-${ROS_DISTRO}-behaviortree-cpp" \
    "ros-${ROS_DISTRO}-ament-cmake-google-benchmark" \
    "ros-${ROS_DISTRO}-nanoflann" \
    "ros-${ROS_DISTRO}-nlohmann-json-schema-validator-vendor" \
    "ros-${ROS_DISTRO}-cv-bridge" \
    "ros-${ROS_DISTRO}-xacro" \
    "ros-${ROS_DISTRO}-rviz2"
}

lock_commit_for() {
  local source_name=$1 url=$2 branch=$3
  [[ -f "$SOURCE_LOCK_FILE" ]] || return 1
  awk -F'|' -v name="$source_name" -v url="$url" -v branch="$branch" \
    '$1 == name && $2 == url && $3 == branch { print $4; exit }' "$SOURCE_LOCK_FILE"
}

record_source_lock() {
  local source_name=$1 url=$2 branch=$3 commit=$4 temporary_lock
  temporary_lock="$(mktemp "$WORKSPACE/.sources.lock.XXXXXX")"
  if [[ -f "$SOURCE_LOCK_FILE" ]]; then
    awk -F'|' -v name="$source_name" -v url="$url" -v branch="$branch" \
      '!($1 == name && $2 == url && $3 == branch) { print }' \
      "$SOURCE_LOCK_FILE" > "$temporary_lock"
  else
    printf '# source-name|url|branch|commit\n' > "$temporary_lock"
  fi
  printf '%s|%s|%s|%s\n' "$source_name" "$url" "$branch" "$commit" >> "$temporary_lock"
  mv -- "$temporary_lock" "$SOURCE_LOCK_FILE"
}

resolve_branch_commit() {
  local url=$1 branch=$2 remote_result commit
  remote_result="$(retry 5 git -c http.version=HTTP/1.1 \
    -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=30 \
    ls-remote --exit-code "$url" "refs/heads/${branch}")"
  commit="${remote_result%%$'\t'*}"
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] \
    || die "Could not resolve a commit for branch '$branch' from $url"
  printf '%s\n' "$commit"
}

source_commit_for() {
  local source_name=$1 url=$2 branch=$3 fixed_commit=${4:-} commit=""
  if [[ "$REFRESH_SOURCE_LOCK" != "1" ]]; then
    commit="$(lock_commit_for "$source_name" "$url" "$branch" || true)"
  fi

  if [[ -z "$commit" ]]; then
    if [[ -n "$fixed_commit" ]]; then
      commit="$fixed_commit"
    else
      commit="$(resolve_branch_commit "$url" "$branch")"
    fi
    [[ "$commit" =~ ^[0-9a-f]{40}$ ]] \
      || die "Invalid pinned commit for $source_name: $commit"
    record_source_lock "$source_name" "$url" "$branch" "$commit"
    printf '\n==> Pinned %s: %s at %s\n' "$source_name" "$branch" "$commit" >&2
  fi
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] \
    || die "Invalid locked commit for $source_name: $commit"
  printf '%s\n' "$commit"
}

checkout_source() {
  local source_name=$1 url=$2 branch=$3 destination=$4 fixed_commit=${5:-}
  local commit staging current_head changes
  commit="$(source_commit_for "$source_name" "$url" "$branch" "$fixed_commit")"

  if [[ -e "$destination/.git" ]]; then
    current_head="$(git -C "$destination" rev-parse --verify HEAD 2>/dev/null)" \
      || die "Existing checkout is invalid: $destination"
    if [[ "$current_head" == "$commit" ]]; then
      log "Keeping existing checkout at pinned commit: $destination"
      return
    fi

    changes="$(git -C "$destination" -c core.fileMode=false status --porcelain --untracked-files=all)"
    [[ -z "$changes" ]] \
      || die "Existing checkout has source changes and is not at required commit $commit: $destination"
    log "Checking out $source_name at pinned commit: $commit"
    retry 5 git -C "$destination" -c http.version=HTTP/1.1 \
      -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=30 \
      fetch --prune origin "refs/heads/${branch}:refs/remotes/origin/${branch}"
    git -C "$destination" cat-file -e "${commit}^{commit}" \
      || die "Pinned commit is unavailable from origin/$branch: $commit ($source_name)"
    git -C "$destination" checkout --detach "$commit"
    return
  fi

  [[ ! -e "$destination" ]] || die "Expected an empty path: $destination"
  staging="${destination}.incomplete.$$"
  [[ ! -e "$staging" ]] || die "Temporary clone path already exists: $staging"
  log "Cloning $source_name from $branch at $commit (up to 5 attempts)"
  retry 5 git -c http.version=HTTP/1.1 \
    -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=30 \
    clone --branch "$branch" --single-branch "$url" "$staging"
  git -C "$staging" cat-file -e "${commit}^{commit}" \
    || die "Pinned commit is unavailable from origin/$branch: $commit ($source_name)"
  git -C "$staging" checkout --detach "$commit"
  mv -- "$staging" "$destination"
}

download_nav2_archive() {
  local destination archive_url archive_file extract_root extracted_directory backup_directory
  destination="$SRC_DIR/navigation2-${NAV2_VERSION}"
  if [[ -d "$destination" ]]; then
    # Nav2 1.5.0 has no top-level CMakeLists.txt.  Check a source file that
    # must be present both for the package and for nav2.patch instead.
    if [[ -f "$destination/nav2_rviz_plugins/src/docking_panel.cpp" ]]; then
      log "Keeping existing Nav2 archive source: $destination"
      return
    fi

    backup_directory="${destination}.incomplete.$(date +%Y%m%d-%H%M%S)"
    log "Moving incomplete Nav2 source aside: $backup_directory"
    mv -- "$destination" "$backup_directory"
  fi
  [[ ! -e "$destination" ]] || die "Expected an empty path: $destination"

  archive_url="https://github.com/ros-navigation/navigation2/archive/refs/tags/${NAV2_VERSION}.zip"
  archive_file="$TEMP_ROOT/navigation2-${NAV2_VERSION}.zip"
  log "Downloading Navigation2 ${NAV2_VERSION} (up to 5 attempts)"
  retry 5 curl -fL --retry 3 --retry-all-errors --connect-timeout 30 \
    --max-time 1800 -o "$archive_file" "$archive_url"
  extract_root="$TEMP_ROOT/navigation2-extract"
  unzip -q "$archive_file" -d "$extract_root"
  extracted_directory="$extract_root/navigation2-${NAV2_VERSION}"
  [[ -d "$extracted_directory" ]] \
    || die "Navigation2 archive did not create the expected directory: $destination"
  mv -- "$extracted_directory" "$destination"
}

apply_patch_to_repository() {
  local patch_file=$1 repository=$2 content_patch

  # Patches created from a copied or mounted workspace may contain accidental
  # 100644 -> 100755 mode changes for every file.  Keep only diff sections
  # containing a content hunk, then remove their mode lines.  Removing merely
  # the mode lines would leave empty `diff --git` sections and make git apply
  # reject the patch as structurally inconsistent.
  content_patch="$(mktemp "$TEMP_ROOT/content-patch.XXXXXX")"
  awk '
    function flush_block(    i) {
      if (has_content_hunk) {
        for (i = 1; i <= line_count; i++) {
          if (lines[i] !~ /^old mode [0-7]{6}$/ && lines[i] !~ /^new mode [0-7]{6}$/) {
            print lines[i]
          }
        }
      }
      delete lines
      line_count = 0
      has_content_hunk = 0
    }
    /^diff --git / {
      flush_block()
    }
    {
      lines[++line_count] = $0
      if ($0 ~ /^@@ /) {
        has_content_hunk = 1
      }
    }
    END {
      flush_block()
    }
  ' "$patch_file" > "$content_patch"
  [[ -s "$content_patch" ]] || die "Patch contains no source-content changes: $patch_file"

  if git -C "$repository" apply --check "$content_patch" >/dev/null 2>&1; then
    log "Applying $(basename "$patch_file") to ${repository#"$SRC_DIR/"}"
    git -C "$repository" apply "$content_patch"
  elif git -C "$repository" apply --reverse --check "$content_patch" >/dev/null 2>&1; then
    log "Patch already applied: $(basename "$patch_file")"
  else
    die "Patch cannot be applied cleanly: $patch_file (repository: $repository)"
  fi
}

apply_unified_patch_to_directory() {
  local patch_file=$1 destination=$2 normalized_patch

  # The existing Nav2 diffs were made with:
  #   diff -ruN navigation2-1.5.0 src/navigation2-1.5.0
  # Normalise both headers to a/ and b/ paths so patch(1) can reliably apply
  # and reverse-check the diff from inside src/navigation2-1.5.0.
  normalized_patch="$(mktemp "$TEMP_ROOT/navigation2-patch.XXXXXX")"
  awk -v version="$NAV2_VERSION" '
    index($0, "--- navigation2-" version "/") == 1 {
      $0 = "--- a/" substr($0, length("--- navigation2-" version "/") + 1)
    }
    index($0, "+++ src/navigation2-" version "/") == 1 {
      $0 = "+++ b/" substr($0, length("+++ src/navigation2-" version "/") + 1)
    }
    { print }
  ' "$patch_file" > "$normalized_patch"

  if patch --batch --forward --strip=1 --directory="$destination" --dry-run < "$normalized_patch" >/dev/null; then
    log "Applying $(basename "$patch_file") to ${destination#"$SRC_DIR/"}"
    patch --batch --forward --strip=1 --directory="$destination" < "$normalized_patch"
  elif patch --batch --reverse --strip=1 --directory="$destination" --dry-run < "$normalized_patch" >/dev/null; then
    log "Patch already applied: $(basename "$patch_file")"
  else
    die "Traditional patch cannot be applied cleanly: $patch_file (directory: $destination)"
  fi
}

require_patch_files() {
  local patch_file
  for patch_file in "$PATCH_DIR/ceres.patch" "$PATCH_DIR/nav2.patch" \
    "$PATCH_DIR/ydlidar.patch" "$PATCH_DIR/velodyne.patch"; do
    [[ -f "$patch_file" ]] || die "Required patch file is missing: $patch_file"
  done
}

apply_known_patches() {
  local ceres_source=$1
  log "Applying Ceres, Nav2, YDLidar, and Velodyne patches"
  apply_patch_to_repository "$PATCH_DIR/ceres.patch" "$ceres_source"
  apply_unified_patch_to_directory "$PATCH_DIR/nav2.patch" "$SRC_DIR/navigation2-${NAV2_VERSION}"
  apply_patch_to_repository "$PATCH_DIR/ydlidar.patch" "$SRC_DIR/ydlidar_ros2_driver"
  apply_patch_to_repository "$PATCH_DIR/velodyne.patch" "$SRC_DIR/velodyne"
}

verify_unitree_source() {
  local package_file
  package_file="$(find "$SRC_DIR" -path '*/package.xml' -print0 \
    | xargs -0r grep -l '<name>unitree_a2_nav</name>' 2>/dev/null \
    | head -n 1 || true)"
  [[ -n "$package_file" ]] || die "unitree_a2_nav was not found below $SRC_DIR. Keep its repository there before running this script."
  log "Found Unitree package: ${package_file%/package.xml}"
}

prepare_workspace_sources() {
  log "Preparing persistent ROS workspace: $WORKSPACE"
  mkdir -p "$SRC_DIR"
  [[ -d "$PATCH_DIR" ]] || die "Expected patches directory: $PATCH_DIR"
  require_patch_files
  verify_unitree_source

  checkout_source ydlidar_ros2_driver https://github.com/YDLIDAR/ydlidar_ros2_driver.git \
    "$YDLIDAR_ROS2_BRANCH" "$SRC_DIR/ydlidar_ros2_driver"
  checkout_source velodyne https://github.com/ros-drivers/velodyne.git \
    "$VELODYNE_BRANCH" "$SRC_DIR/velodyne" "$VELODYNE_COMMIT"
  checkout_source slam_toolbox https://github.com/SteveMacenski/slam_toolbox.git \
    "$SLAM_TOOLBOX_BRANCH" "$SRC_DIR/slam_toolbox"
  checkout_source robot_localization https://github.com/cra-ros-pkg/robot_localization.git \
    "$ROBOT_LOCALIZATION_BRANCH" "$SRC_DIR/robot_localization"
  download_nav2_archive
  checkout_source nav2_minimal_turtlebot_simulation \
    https://github.com/ros-navigation/nav2_minimal_turtlebot_simulation.git \
    "$NAV2_SIM_BRANCH" "$SRC_DIR/nav2_minimal_turtlebot_simulation"
  checkout_source cyclonedds https://github.com/eclipse-cyclonedds/cyclonedds.git \
    "$CYCLONEDDS_BRANCH" "$SRC_DIR/cyclonedds"
  checkout_source rmw_cyclonedds https://github.com/ros2/rmw_cyclonedds.git \
    "$RMW_CYCLONEDDS_BRANCH" "$SRC_DIR/rmw_cyclonedds"
}

cmake_install() {
  local source_dir=$1
  shift
  cmake -S "$source_dir" -B "$source_dir/build" "$@"
  cmake --build "$source_dir/build" --parallel "$(nproc)"
  sudo cmake --install "$source_dir/build"
  sudo ldconfig
}

install_native_dependencies() {
  local ydlidar_sdk ceres ompl geographiclib ompl_archive

  log "Fetching native dependency sources in $TEMP_ROOT"
  ydlidar_sdk="$TEMP_ROOT/YDLidar-SDK"
  checkout_source ydlidar_sdk https://github.com/YDLIDAR/YDLidar-SDK.git \
    "$YDLIDAR_SDK_BRANCH" "$ydlidar_sdk"

  ceres="$TEMP_ROOT/ceres-solver"
  checkout_source ceres https://github.com/ceres-solver/ceres-solver.git \
    "$CERES_BRANCH" "$ceres"

  ompl_archive="$TEMP_ROOT/ompl-${OMPL_VERSION}.tar.gz"
  retry 5 curl -fL --retry 3 --retry-all-errors --connect-timeout 30 \
    --max-time 1800 -o "$ompl_archive" \
    "https://github.com/ompl/ompl/releases/download/${OMPL_VERSION}/ompl-${OMPL_VERSION}.tar.gz"
  tar -xzf "$ompl_archive" -C "$TEMP_ROOT"
  ompl="$TEMP_ROOT/ompl-${OMPL_VERSION}"
  [[ -d "$ompl" ]] || die "OMPL archive did not create $ompl."

  geographiclib="$TEMP_ROOT/geographiclib"
  checkout_source geographiclib https://github.com/geographiclib/geographiclib.git \
    "$GEOGRAPHICLIB_BRANCH" "$geographiclib"

  apply_known_patches "$ceres"

  log "Building native dependencies in $TEMP_ROOT"
  cmake_install "$ydlidar_sdk"
  cmake_install "$ceres" -DBUILD_TESTING=OFF -DWITH_SUITESPARSE=ON
  cmake_install "$ompl" -DBUILD_TESTING=OFF
  cmake_install "$geographiclib"

  echo '/usr/local/lib' | sudo tee /etc/ld.so.conf.d/ros2-local-libraries.conf >/dev/null
  sudo ldconfig
}

configure_velodyne_firewall() {
  local ethernet_interface zone dds_answer
  if ! systemctl is-active --quiet firewalld; then
    log "firewalld is inactive; no Velodyne port rule is needed"
    return
  fi

  require_command nmcli
  ethernet_interface="$(nmcli -t -f DEVICE,TYPE,STATE device status \
    | awk -F: '$2 == "ethernet" && $3 == "connected" { print $1; exit }')"
  [[ -n "$ethernet_interface" ]] || die "No connected Ethernet interface found for the Velodyne sensor."
  zone="$(sudo firewall-cmd --get-zone-of-interface="$ethernet_interface")"
  if [[ "$zone" == "no zone" ]]; then
    zone="$(sudo firewall-cmd --get-default-zone)"
  fi

  log "Allowing Velodyne UDP 2368 on interface $ethernet_interface in zone $zone"
  sudo firewall-cmd --permanent --zone="$zone" --add-port=2368/udp
  sudo firewall-cmd --reload

  printf '\nCyclone DDS firewall setup:\n'
  printf '  Local-only ROS 2 needs no extra firewall rule.\n'
  printf '  Move selected DDS interface %s to the trusted zone for DDS networking with other hosts? [y/N] ' \
    "$CYCLONEDDS_INTERFACE"
  read -r dds_answer || dds_answer="N"
  if [[ "$dds_answer" =~ ^[Yy]$ ]]; then
    log "Moving $CYCLONEDDS_INTERFACE to the trusted firewalld zone for Cyclone DDS"
    sudo firewall-cmd --permanent --zone=trusted --add-interface="$CYCLONEDDS_INTERFACE"
    sudo firewall-cmd --reload
  else
    log "Leaving $CYCLONEDDS_INTERFACE in its current firewall zone"
  fi
}

build_cyclonedds_without_ros_underlay() {
  log "Building Cyclone DDS before sourcing the ROS underlay"

  env \
    -C "$WORKSPACE" \
    -u AMENT_PREFIX_PATH \
    -u CMAKE_PREFIX_PATH \
    -u COLCON_PREFIX_PATH \
    -u LD_LIBRARY_PATH \
    -u PYTHONPATH \
    -u RMW_IMPLEMENTATION \
    -u ROS_DISTRO \
    -u ROS_PYTHON_VERSION \
    -u ROS_VERSION \
    colcon build --packages-select cyclonedds
}

source_setup_file() {
  local setup_file=$1 had_nounset=0

  # ROS-generated setup files legitimately read optional variables that may be
  # unset.  The installer itself remains strict; nounset is disabled only
  # while sourcing the generated setup file.
  [[ $- == *u* ]] && had_nounset=1
  set +u
  # shellcheck disable=SC1090
  source "$setup_file"
  if (( had_nounset )); then
    set -u
  fi
}

build_workspace() {
  log "Sourcing ROS Lyrical and building the complete workspace"
  # rmw_cyclonedds_cpp is part of this build, so it cannot be selected until
  # the overlay has been installed. Let the ROS underlay use its own default
  # RMW implementation while CMake configures every workspace package.
  unset RMW_IMPLEMENTATION
  source_setup_file "/opt/ros/${ROS_DISTRO}/setup.bash"
  cd "$WORKSPACE"
  colcon build --symlink-install --cmake-args -DBUILD_TESTING=OFF
}

select_cyclonedds_interface() {
  local -a interfaces=()
  local selection index
  require_command nmcli
  mapfile -t interfaces < <(nmcli -t -f DEVICE,TYPE,STATE device status \
    | awk -F: '$2 == "ethernet" && $3 == "connected" { print $1 }')
  (( ${#interfaces[@]} > 0 )) \
    || die "No connected Ethernet interfaces are available for Cyclone DDS."

  printf '\nCyclone DDS interface selection:\n'
  for index in "${!interfaces[@]}"; do
    printf '  %d) %s\n' "$((index + 1))" "${interfaces[index]}"
  done
  while true; do
    printf 'Select the Ethernet interface for Cyclone DDS [1-%d]: ' "${#interfaces[@]}"
    read -r selection
    [[ "$selection" =~ ^[0-9]+$ ]] || continue
    (( selection >= 1 && selection <= ${#interfaces[@]} )) || continue
    CYCLONEDDS_INTERFACE="${interfaces[selection - 1]}"
    break
  done
  log "Cyclone DDS will use interface $CYCLONEDDS_INTERFACE"
}

cyclonedds_uri() {
  [[ -n "$CYCLONEDDS_INTERFACE" && "$CYCLONEDDS_INTERFACE" =~ ^[[:alnum:]_.:-]+$ ]] \
    || die "Invalid Cyclone DDS interface name: $CYCLONEDDS_INTERFACE"
  printf '<CycloneDDS><Domain><General><Interfaces><NetworkInterface name="%s"/></Interfaces></General></Domain></CycloneDDS>' \
    "$CYCLONEDDS_INTERFACE"
}

activate_workspace() {
  log "Activating the ROS and workspace environments for validation"

  source_setup_file "/opt/ros/${ROS_DISTRO}/setup.bash"
  source_setup_file "$WORKSPACE/install/setup.bash"

  export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp

  CYCLONEDDS_URI="$(cyclonedds_uri)"
  export CYCLONEDDS_URI

  ros2 pkg list | grep -qx unitree_a2_nav ||
    die "The Unitree package is absent after the build."

  ros2 pkg list | grep -qx rmw_cyclonedds_cpp ||
    die "The CycloneDDS RMW package is absent after the build."
}

add_workspace_to_bashrc() {
  local bashrc="$HOME/.bashrc" temporary_bashrc
  local begin_marker='# >>> robot_ws ROS 2 Lyrical >>>'
  local end_marker='# <<< robot_ws ROS 2 Lyrical <<<'

  touch "$bashrc"
  if grep -Fqx "$begin_marker" "$bashrc"; then
    grep -Fqx "$end_marker" "$bashrc" \
      || die "Managed ROS workspace block in $bashrc is incomplete. Repair it before rerunning."
    log "Updating ROS workspace environment in $bashrc"
  else
    log "Adding ROS workspace environment to $bashrc"
  fi

  # Remove the previous managed block, if any, so a rerun updates its DDS
  # configuration without touching the user's unrelated .bashrc content.
  temporary_bashrc="$(mktemp "$HOME/.bashrc.robot_ws.XXXXXX")"
  awk -v begin="$begin_marker" -v end="$end_marker" '
    $0 == begin { inside = 1; next }
    $0 == end { inside = 0; next }
    !inside { print }
  ' "$bashrc" > "$temporary_bashrc"
  {
    printf '\n%s\n' "$begin_marker"
    printf 'source %q\n' "/opt/ros/${ROS_DISTRO}/setup.bash"
    printf 'source %q\n' "$WORKSPACE/install/setup.bash"
    printf 'export RMW_IMPLEMENTATION=%q\n' 'rmw_cyclonedds_cpp'
    printf 'export CYCLONEDDS_URI=%q\n' "$(cyclonedds_uri)"
    printf '%s\n' "$end_marker"
  } >> "$temporary_bashrc"
  mv -- "$temporary_bashrc" "$bashrc"
}

cleanup_successfully_installed_sources() {
  log "Native libraries installed and verified; removing temporary build sources"
  rm -rf -- "$TEMP_ROOT"
  TEMP_ROOT=""
}

request_reboot() {
  local answer
  printf '\nSetup complete. Reboot now to apply any updated kernel and device-group changes? [y/N] '
  read -r answer
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    sudo systemctl reboot
  else
    printf 'Reboot later with: sudo systemctl reboot\n'
  fi
  printf 'New Bash terminals will automatically load ROS Lyrical, %s, and CycloneDDS RMW.\n' "$WORKSPACE"
}

main() {
  require_rhel10
  require_command sudo
  TEMP_ROOT="$(mktemp -d /tmp/ros2-lyrical-build.XXXXXX)"

  enable_repositories
  install_ros_repository
  install_rpms
  require_command git
  prepare_workspace_sources
  install_native_dependencies
  build_cyclonedds_without_ros_underlay
  build_workspace
  select_cyclonedds_interface
  activate_workspace
  configure_velodyne_firewall
  cleanup_successfully_installed_sources
  # Persist the environment only after every install, build, validation,
  # firewall, and cleanup step has completed successfully.
  add_workspace_to_bashrc
  request_reboot
}

main "$@"
