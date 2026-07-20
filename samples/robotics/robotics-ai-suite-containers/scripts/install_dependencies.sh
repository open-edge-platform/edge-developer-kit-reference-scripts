#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2025 Intel Corporation
#
# Install dependencies for Robotics AI Suite sample pipelines.
#
# Usage: ./install_dependencies.sh [OPTIONS]
#   -s, --sample  <name>   Sample to install dependencies for
#   -h, --help             Show this help message and exit

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly HUMANOID_DIR="${SCRIPT_DIR}/pipelines"

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------

if [[ -t 1 && -t 2 ]]; then
    _CLR_RESET="\033[0m"
    _CLR_INFO="\033[0;32m"   # green
    _CLR_WARN="\033[0;33m"   # yellow
    _CLR_ERROR="\033[0;31m"  # red
else
    _CLR_RESET="" _CLR_INFO="" _CLR_WARN="" _CLR_ERROR=""
fi

log_info()  { echo -e "${_CLR_INFO}[INFO]  $*${_CLR_RESET}"; }
log_warn()  { echo -e "${_CLR_WARN}[WARN]  $*${_CLR_RESET}" >&2; }
log_error() { echo -e "${_CLR_ERROR}[ERROR] $*${_CLR_RESET}" >&2; }
die()       { log_error "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Idempotency helpers
# ---------------------------------------------------------------------------

mark_setup_done() { touch "${1}/.setup_done"; }
is_setup_done()   { [[ -f "${1}/.setup_done" ]]; }

# Read a secret from stdin, echoing '*' for each character typed instead of
# the actual characters. Usage: read_secret "Prompt: " VAR_NAME
read_secret() {
    local prompt="$1" var_name="$2"
    local char secret=""
    printf '%s' "${prompt}"
    while IFS= read -rs -n 1 char; do
        [[ -z "${char}" ]] && break  # Enter pressed
        if [[ "${char}" == $'\x7f' ]]; then  # Backspace
            if [[ -n "${secret}" ]]; then
                secret="${secret%?}"
                printf '\b \b'
            fi
        else
            secret+="${char}"
            printf '*'
        fi
    done
    echo
    printf -v "${var_name}" '%s' "${secret}"
}

# ---------------------------------------------------------------------------
# act-sample
# ---------------------------------------------------------------------------

install_act_sample() {
    local pipeline_dir="${HUMANOID_DIR}/act-sample"
    local act_dir="${pipeline_dir}/act"

    [[ -d "${act_dir}" ]] \
        || die "act submodule not found at '${act_dir}'. Run 'git submodule update --init --recursive'."

    log_info "Installing act-sample ..."

    # --- Python virtual environment ---
    pushd "${pipeline_dir}" >/dev/null
    if [[ ! -d .venv ]]; then
        log_info "Creating Python virtual environment ..."
        python3 -m venv .venv
    fi
    # shellcheck source=/dev/null
    source .venv/bin/activate

    if is_setup_done "${pipeline_dir}"; then
        log_info "Python dependencies already installed (delete '${pipeline_dir}/.setup_done' to reinstall)."
    else
        log_info "Installing Python dependencies ..."
        python3 -m pip install --upgrade pip
        python3 -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
        python3 -m pip install \
            pyquaternion==0.9.9 \
            pyyaml \
            rospkg==1.5.0 \
            pexpect==4.8.0 \
            mujoco==3.2.6 \
            dm_control==1.0.26 \
            matplotlib==3.10.0 \
            einops==0.6.0 \
            packaging==23.0 \
            h5py==3.12.1 \
            ipython==8.12.0 \
            opencv-python==4.10.0.84 \
            transformers==4.37.0 \
            accelerate==0.23.0 \
            huggingface-hub==0.24.7 \
            openvino==2026.2.0 
        mark_setup_done "${pipeline_dir}"
    fi
    popd >/dev/null

    # --- Reset ACT source to a clean, known state then apply patches ---
    pushd "${act_dir}" >/dev/null
    log_info "Resetting ACT source to clean state (commit 742c753) ..."
    git fetch --all
    git checkout -f 742c753c0d4a5d87076c8f69e5628c79a8cc5488
    git clean -fdx

    log_info "Applying OpenVINO patches ..."
    git apply /opt/act-ov/0001-enable-openvino-inference-for-eval.patch
    git apply /opt/act-ov/0002-add-model-conversion-script.patch
    git apply /opt/act-ov/0003-changes-for-real-robot.patch
    git apply /opt/act-ov/0004-Modify-the-camera-mode-to-fixed.patch
    git apply /opt/act-ov/0005-Modify-the-default-cameras-config.patch

    log_info "Installing DETR package ..."
    python3 -m pip install -e detr/

    # --- Download simulation dataset (idempotent) ---
    # Stored in pipeline_dir (one level up) so git clean -fdx cannot wipe it.
    # A symlink is (re)created inside act_dir after every git clean.
    if [[ ! -d "${pipeline_dir}/sim_insertion_scripted" ]]; then
        log_info "Downloading simulation dataset ..."
        wget -q \
            https://eci.intel.com/embodied-sdk-docs/_downloads/sim_insertion_scripted.zip \
            -O "${pipeline_dir}/sim_insertion_scripted.zip"
        unzip -q "${pipeline_dir}/sim_insertion_scripted.zip" -d "${pipeline_dir}"
        rm "${pipeline_dir}/sim_insertion_scripted.zip"
    else
        log_info "Simulation dataset already present, skipping download."
    fi
    ln -sfn "${pipeline_dir}/sim_insertion_scripted" sim_insertion_scripted

    # --- Convert model to OpenVINO IR ---
    log_info "Converting model to OpenVINO IR ..."
    python3 ov_convert.py \
        --ckpt_path ./sim_insertion_scripted/four_camera/policy_best.ckpt \
        --height 480 \
        --weight 640 \
        --camera_num 4 \
        --chunk_size 100

    # Patch the data directory path in constants.py
    sed -i 's|DATA_DIR = .*|DATA_DIR = "./sim_insertion_scripted/four_camera"|' constants.py

    popd >/dev/null
}

install_collaborative_visual_slam() {
    log_info "No extra dependencies required for collaborative-visual-slam."
}

install_wandering_app_simulation() {
    log_info "No extra dependencies required for wandering-app-simulation."
}

# ---------------------------------------------------------------------------
# Stub handlers — humanoid-imitation-learning samples
# (Remove the `die` line and implement the body when ready.)
# ---------------------------------------------------------------------------

install_diffusion_policy_ov() {
    # TODO: Apply patches from pipelines/diffusion-policy-ov/patches/.
    # Ref:  pipelines/diffusion-policy-ov/README.md
    die "diffusion-policy-ov install is not yet implemented in this launcher."
}

install_idp3_ov() {
    # TODO: Apply patches from pipelines/idp3-ov/patches/.
    # Ref:  pipelines/idp3-ov/README.md
    die "idp3-ov install is not yet implemented in this launcher."
}

install_llm_robotics_demo() {
    # TODO: Install PLCopen + ROS2 Jazzy deps and configure JAKA robot arm.
    # Ref:  pipelines/llm-robotics-demo/README.md
    die "llm-robotics-demo install is not yet implemented in this launcher."
}

install_mpc_demo() {
    # TODO: Build ocs2 / ocs2_robotic_assets.
    # Ref:  pipelines/mpc-demo/README.md
    die "mpc-demo install is not yet implemented in this launcher."
}

install_openclaw_agenticros_demo() {
    # TODO: Set up agenticros, openclaw, and the warehouse world environment.
    # Ref:  pipelines/openclaw-agenticros-demo/README.md
    die "openclaw-agenticros-demo install is not yet implemented in this launcher."
}

# ---------------------------------------------------------------------------
# pi05-rtc-ov
# ---------------------------------------------------------------------------

install_pi05_rtc_ov() {
    local pipeline_dir="${HUMANOID_DIR}/pi05-rtc-ov"
    local lerobot_dir="${pipeline_dir}/lerobot"
    local pi05_ov_dir="${lerobot_dir}/examples/pi05_with_openvino"
    local models_dir="${pipeline_dir}/models"
    local ov_models_dir="${pipeline_dir}/ov_models"

    log_info "Installing pi05-rtc-ov ..."

    # Check for HF_TOKEN (required for model download)
    if [[ -z "${HF_TOKEN:-}" && -t 0 ]]; then
        read_secret "Enter your Hugging Face token: " HF_TOKEN
        export HF_TOKEN
    fi

    if [[ -z "${HF_TOKEN:-}" ]]; then
        die "Using the Pi0.5 model in LeRobot will automatically download the [google/paligemma-3b-pt-224](https://huggingface.co/google/paligemma-3b-pt-224) from Hugging Face. Due to author restrictions, downloading the model requires logging into your Hugging Face account. 
If you encounter download errors, follow the [instructions](https://huggingface.co/docs/huggingface_hub/quick-start#authentication) on how to log in and authorize your account.
Export your Hugging Face token as an environment variable before running this script:
export HF_TOKEN=<your_huggingface_token>"
    fi

    # --- Init submodule from the pipeline dir (parent of lerobot) ---
    if [[ ! -d "${lerobot_dir}/.git" ]]; then
        log_info "Initialising lerobot submodule ..."
        pushd "${pipeline_dir}" >/dev/null
        git submodule update --init lerobot \
            || die "Failed to init lerobot submodule. Check your git configuration."
        popd >/dev/null
    fi

    # --- Reset lerobot source to clean state then apply patches ---
    pushd "${lerobot_dir}" >/dev/null
    log_info "Resetting lerobot source to clean state ..."
    git fetch --all
    git checkout -f
    git clean -fdx

    log_info "Applying pi05-rtc-ov patches ..."
    git apply --whitespace=fix "${pipeline_dir}"/patches/*.patch \
        || die "Failed to apply patches to lerobot. Check for conflicts."

    # --- Install dependencies ---
    log_info "Installing lerobot pi-ov dependencies ..."
    uv sync --extra pi-ov

    # --- Download model checkpoint (idempotent) ---
    mkdir -p "${models_dir}"
    if [[ ! -d "${models_dir}/sim_transfer_4c_chunk75" ]]; then
        log_info "Downloading Pi0.5 model checkpoint ..."
        wget --show-progress -q https://eci.intel.com/embodied-sdk-docs/_downloads/checkpoint.tar.gz \
            -O "${models_dir}/checkpoint.tar.gz"
        tar -xzf "${models_dir}/checkpoint.tar.gz" -C "${models_dir}"
        rm "${models_dir}/checkpoint.tar.gz"
    else
        log_info "Model checkpoint already present, skipping download."
    fi

    # --- Convert checkpoint to OpenVINO FP16 and INT8 IR ---
    if [[ ! -d "${ov_models_dir}_4c_FP16" ]] || [[ ! -d "${ov_models_dir}_4c_INT8" ]]; then
        log_info "Converting Pi0.5 checkpoint to FP16 and INT8 OpenVINO IR ..."
        uv run --extra pi-ov --with nncf "${pi05_ov_dir}/scripts/convert_ov.py" \
            --torch_dir "${models_dir}/sim_transfer_4c_chunk75" \
            --ov_output_dir "${ov_models_dir}" \
            --compress_int8 || true
        # Validate the actual artifacts rather than trusting the exit code.
        if [[ ! -f "${ov_models_dir}_4c_FP16/model.xml" ]] || [[ ! -f "${ov_models_dir}_4c_INT8/model.xml" ]]; then
            die "Failed to convert Pi0.5 checkpoint to FP16 and INT8 OpenVINO IR."
        fi
    else
        log_info "OpenVINO IR models already present (delete '${ov_models_dir}_4c_FP16' or '${ov_models_dir}_4c_INT8' to reconvert)."
    fi

    popd >/dev/null
}

install_rdt_ov() {
    local act_sample_dir="${HUMANOID_DIR}/act-sample"
    local rdt_ov_dir="${HUMANOID_DIR}/rdt-ov"
    local t5_dir="${rdt_ov_dir}/google/t5-v1_1-xxl"
    local t5_lfs_done="${t5_dir}/.lfs_pull_done"

    # Check if the total ram deduct current usage and the leftover is more than 44GB, else die with warning that not enough RAM.
    total_ram=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    used_ram=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
    free_ram=$((total_ram - used_ram))
    if (( free_ram < 44 * 1024 * 1024 )); then
        die "Insufficient RAM. At least 44GB of free RAM is required for rdt-ov runtime. Exiting installation."
    fi

    if [[ -f "${t5_lfs_done}" ]]; then
        log_info "T5 model already fully downloaded at '${t5_dir}', skipping."
    else
        if [[ ! -d "${t5_dir}" ]]; then
            log_info "Checking for preflight requirements for rdt-ov installation ..."
            # check if disk has 200GB
            disk_space=$(df --output=avail -k . | tail -n 1)
            log_info "Available disk space: $((disk_space / 1024 / 1024)) GB"
            if (( disk_space < 200 * 1024 * 1024 )); then
                die "Insufficient disk space. At least 200GB of free space is required for rdt-ov installation."
            fi

            mkdir -p "${rdt_ov_dir}/google"
            cd "${rdt_ov_dir}/google" || die "Failed to change directory to '${rdt_ov_dir}/google'."
            GIT_LFS_SKIP_SMUDGE=1 git clone https://hf-mirror.com/google/t5-v1_1-xxl
        else
            log_info "T5 repo already cloned but LFS pull incomplete, resuming ..."
        fi

        cd "${t5_dir}" || die "Failed to change directory to '${t5_dir}'."
        git lfs pull || die "git lfs pull failed. Re-run the script to retry."
        touch "${t5_lfs_done}"
    fi

    log_info "Installing rdt-ov ..."
    log_info "Rdt-ov required act-sample to be installed first. Installing act-sample ..."
    install_act_sample

    cd "${rdt_ov_dir}" || die "Failed to change directory to '${rdt_ov_dir}'."
    log_info "Setting up rdt-ov environment ..."
    mkdir -p "${rdt_ov_dir}/models"
    if [[ ! -f "${rdt_ov_dir}/models/pytorch_model.bin" ]]; then
        wget --show-progress -q https://eci.intel.com/embodied-sdk-docs/_downloads/RDT-sim-ft-weights.zip -O "${rdt_ov_dir}/models/RDT-sim-ft-weights.zip"
        unzip -q "${rdt_ov_dir}/models/RDT-sim-ft-weights.zip" -d "${rdt_ov_dir}/models/"
        rm "${rdt_ov_dir}/models/RDT-sim-ft-weights.zip"
    fi

    pushd "${rdt_ov_dir}" >/dev/null

    if [[ ! -d ".venv" ]]; then
        log_info "Creating Python virtual environment for rdt-ov ..."
        uv venv --python=3.11 .venv
    fi
    # shellcheck source=/dev/null
    source .venv/bin/activate

    if [[ ! -d RoboticsDiffusionTransformer ]]; then
        log_info "Cloning RoboticsDiffusionTransformer repository ..."
        git clone https://github.com/thu-ml/RoboticsDiffusionTransformer.git
    fi

    log_info "Setting up RoboticsDiffusionTransformer ..."
    cd "${rdt_ov_dir}/RoboticsDiffusionTransformer" || die "Failed to change directory to '${rdt_ov_dir}/RoboticsDiffusionTransformer'."
    git fetch --all
    git checkout -f 9af5241cb4456836ddf852b5a0286441f7b5d1d6
    git clean -fdx
    git apply "${rdt_ov_dir}"/patches/0001-add-language-convert-script.patch
    git apply "${rdt_ov_dir}"/patches/0002-add-MUJOCO-pipeline-for-cuda.patch
    git apply "${rdt_ov_dir}"/patches/0003-add-MUJOCO-OpenVINO-pipeline.patch
    git apply "${rdt_ov_dir}"/patches/0004-add-OpenVINO-convert-script.patch
    git apply "${rdt_ov_dir}"/patches/0005-Add-jupyter-notebook-guide-and-enable-t5-model-conve.patch
    git apply "${rdt_ov_dir}"/patches/0006-add-dockerfile-5.patch
    git apply "${rdt_ov_dir}"/patches/0001-Fix-unsafe-PyTorch-load-issue.patch

    mkdir -p "${rdt_ov_dir}/RoboticsDiffusionTransformer/eval_sim/assets/mujoco/"
    cp -r "${act_sample_dir}/act/assets/"* "${rdt_ov_dir}/RoboticsDiffusionTransformer/eval_sim/assets/mujoco/" || die "Failed to copy assets from act-sample to rdt-ov."

    uv pip install --upgrade pip
    uv pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
    uv pip install packaging
    uv pip install -r requirements.txt
    uv pip install huggingface_hub==0.23.4 opencv-python==4.10.0.84 numpy==1.26.4 mujoco==3.2.6 dm_control==1.0.26 einops ipython
    uv pip install openvino==2026.2.0

    log_info "Converting Pytorch model to OpenVINO format ..."
    if [[ ! -d "${rdt_ov_dir}/ov_models" ]]; then
        uv run python3 -m scripts.convert.ov_convert --pretrained "${rdt_ov_dir}/models/pytorch_model.bin" --output_dir "${rdt_ov_dir}/ov_models"
    fi

    popd >/dev/null
}

# ---------------------------------------------------------------------------
# Usage / argument parsing
# ---------------------------------------------------------------------------

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  -s, --sample  <name>   Sample to install dependencies for
  -h, --help             Show this help message and exit

Samples:
  act-sample | diffusion-policy-ov | idp3-ov | llm-robotics-demo | mpc-demo |
  openclaw-agenticros-demo | pi05-rtc-ov | rdt-ov

Examples:
  $(basename "$0") --sample act-sample
  $(basename "$0") --sample pi05-rtc-ov
EOF
}

# Check if ENV SAMPLE_NAME is set, if yes, set to OPT_SAMPLE
if [[ -n "${SAMPLE_NAME:-}" ]]; then
    OPT_SAMPLE="${SAMPLE_NAME}"
else
    OPT_SAMPLE=""
fi

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -s|--sample)  OPT_SAMPLE="$2"; shift 2 ;;
            -h|--help)    usage; exit 0 ;;
            *)            die "Unknown argument: '$1'. Run with --help for usage." ;;
        esac
    done
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    parse_args "$@"
    if [[ -n "${OPT_SAMPLE}" ]]; then
        case "${OPT_SAMPLE}" in
            act-sample)                     install_act_sample ;;
            pi05-rtc-ov)                    install_pi05_rtc_ov ;;
            collaborative-visual-slam)      install_collaborative_visual_slam ;;
            wandering-app-simulation)       install_wandering_app_simulation ;;
            diffusion-policy-ov)            install_diffusion_policy_ov ;;
            idp3-ov)                        install_idp3_ov ;;
            llm-robotics-demo)              install_llm_robotics_demo ;;
            mpc-demo)                       install_mpc_demo ;;
            openclaw-agenticros-demo)       install_openclaw_agenticros_demo ;;
            rdt-ov)                         install_rdt_ov ;;
            *) die "Unknown sample: '${OPT_SAMPLE}'. Run with --help for usage." ;;
        esac
    else
        die "Either --sample must be specified. Run with --help for usage."
    fi
}

main "$@"
