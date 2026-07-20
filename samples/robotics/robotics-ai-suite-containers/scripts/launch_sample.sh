#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2025 Intel Corporation
#
# Entrypoint: install and run Robotics AI Suite sample pipelines.
#
# Usage: ./launch_sample.sh [OPTIONS]
#   -s, --sample  <name>   Sample to run (e.g. act-sample)
#   -d, --device  <name>   OpenVINO inference device (e.g. CPU, GPU, NPU) [default: CPU]
#   -r, --render           Enable onscreen rendering [default: off]
#   -h, --help             Show this help message and exit
#
# Omit any option to be prompted interactively.

set -euo pipefail

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly HUMANOID_SAMPLE_DIR="${SCRIPT_DIR}/pipelines"
readonly SAMPLE_LIST=(
    "act-sample"
    "pi05-rtc-ov"
    "collaborative-visual-slam"
    "wandering-app-simulation"
    "rdt-ov"
    "idp3-ov"
    "llm-robotics-demo"
    "mpc-demo"
    "openclaw-agenticros-demo"
    "diffusion-policy-ov"
)

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------

# Use colors only when stdout/stderr is a terminal
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
# Prerequisites
# ---------------------------------------------------------------------------

require_cmd() {
    command -v "$1" &>/dev/null \
        || die "Required command not found: '$1'. Please install it before running this script."
}

check_prerequisites() {
    require_cmd python3
    require_cmd git
}

# ---------------------------------------------------------------------------
# Validation helper
# ---------------------------------------------------------------------------

# contains_element VALUE ARRAY...  — returns 0 if VALUE is in ARRAY, else 1
contains_element() {
    local match="$1"; shift
    local elem
    for elem; do [[ "${elem}" == "${match}" ]] && return 0; done
    return 1
}

# ---------------------------------------------------------------------------
# Idempotency helpers
# ---------------------------------------------------------------------------

mark_setup_done() { touch "${1}/.setup_done"; }
is_setup_done()   { [[ -f "${1}/.setup_done" ]]; }

# ---------------------------------------------------------------------------
# Interactive selection
# Uses global SELECTED to avoid stdout-capture issues with `select`.
# ---------------------------------------------------------------------------

SELECTED=""

# select_from_menu [--default VALUE] PROMPT OPTIONS...
# Prints a numbered menu and reads a selection via `read`.
# If --default is given, pressing Enter (empty input) selects that value.
select_from_menu() {
    local default=""
    if [[ "${1:-}" == "--default" ]]; then
        default="$2"; shift 2
    fi
    local prompt="$1"; shift
    local -a options=("$@")
    SELECTED=""

    local i
    for (( i=1; i<=${#options[@]}; i++ )); do
        echo "${i}) ${options[$((i-1))]}"
    done

    local reply
    while true; do
        read -rp "${prompt} " reply
        if [[ -z "${reply}" && -n "${default}" ]]; then
            SELECTED="${default}"
            return
        elif [[ "${reply}" =~ ^[0-9]+$ ]] \
            && (( reply >= 1 && reply <= ${#options[@]} )); then
            SELECTED="${options[$((reply-1))]}"
            return
        else
            echo "Invalid selection. Please try again."
        fi
    done
}

# ---------------------------------------------------------------------------
# act-sample
# ---------------------------------------------------------------------------

run_act_sample() {
    local device="$1"
    local onscreen_render="$2"
    local pipeline_dir="${HUMANOID_SAMPLE_DIR}/act-sample"
    local act_dir="${pipeline_dir}/act"

    log_info "Running act-sample (device=${device}, onscreen_render=${onscreen_render}) ..."

    # Activate virtual environment
    # shellcheck source=/dev/null
    source "${pipeline_dir}/.venv/bin/activate"

    pushd "${act_dir}" >/dev/null

    # Ensure dataset symlink exists (re-created after every git clean)
    ln -sfn "${pipeline_dir}/sim_insertion_scripted" sim_insertion_scripted

    # --- Run inference ---
    log_info "Running inference ..."
    local -a run_args=(
        imitate_episodes.py
        --task_name sim_insertion_scripted
        --ckpt_dir ./sim_insertion_scripted/four_camera
        --policy_class ACT
        --kl_weight 10
        --chunk_size 100
        --hidden_dim 512
        --batch_size 8
        --dim_feedforward 3200
        --num_epochs 2000
        --lr 1e-5
        --seed 0
        --device "${device}"
        --eval
    )

    if [[ "${onscreen_render}" == "yes" ]]; then
        MUJOCO_GL=egl python3 "${run_args[@]}" --onscreen_render
    else
        MUJOCO_GL=egl python3 "${run_args[@]}"
    fi

    popd >/dev/null
}

# ---------------------------------------------------------------------------
# Stub handlers — humanoid-imitation-learning samples
# (Remove the `die` lines and implement the bodies when ready.)
# ---------------------------------------------------------------------------

run_diffusion_policy_ov() {
    # TODO: Run Diffusion Policy pipeline.
    # Ref:  pipelines/diffusion-policy-ov/README.md
    die "diffusion-policy-ov is not yet implemented in this launcher."
}

run_idp3_ov() {
    # TODO: Run IDP3 pipeline.
    # Ref:  pipelines/idp3-ov/README.md
    die "idp3-ov is not yet implemented in this launcher."
}

run_llm_robotics_demo() {
    # TODO: Launch LLM/ASR/TTS services from pipelines/llm-robotics-demo/.
    # Ref:  pipelines/llm-robotics-demo/README.md
    die "llm-robotics-demo is not yet implemented in this launcher."
}

run_mpc_demo() {
    # TODO: Launch the MPC demo.
    # Ref:  pipelines/mpc-demo/README.md
    die "mpc-demo is not yet implemented in this launcher."
}

run_openclaw_agenticros_demo() {
    # TODO: Launch the openclaw agenticros demo.
    # Ref:  pipelines/openclaw-agenticros-demo/README.md
    die "openclaw-agenticros-demo is not yet implemented in this launcher."
}

run_pi05_rtc_ov() {
    local device="$1"
    local pipeline_dir="${HUMANOID_SAMPLE_DIR}/pi05-rtc-ov"
    local lerobot_dir="${pipeline_dir}/lerobot"
    local pi05_ov_dir="${lerobot_dir}/examples/pi05_with_openvino"
    local models_dir="${pipeline_dir}/models"
    local ov_models_dir="${pipeline_dir}/ov_models"

    pushd "${lerobot_dir}" >/dev/null

    # --- Run benchmark ---
    log_info "Running Pi0.5+RTC FP16 benchmark (device=${device}) ..."
    uv run --extra pi-ov "${pi05_ov_dir}/scripts/benchmark_pi05_ov_rtc.py" \
        --model_dir "${ov_models_dir}_4c_FP16" \
        --device "${device}" \
        --chunk_size 75 \
        -n 5 \
        || die "Pi0.5+RTC FP16 benchmark failed."

    log_info "Running Pi0.5+RTC INT8 benchmark (device=${device}) ..."
    uv run --extra pi-ov "${pi05_ov_dir}/scripts/benchmark_pi05_ov_rtc.py" \
        --model_dir "${ov_models_dir}_4c_INT8" \
        --device "${device}" \
        --chunk_size 75 \
        -n 5 \
        || die "Pi0.5+RTC INT8 benchmark failed."

    log_info "Running sim_transfer_cube simulation in Mujoco (device=${device}) ..."
    MUJOCO_GL=egl uv run --extra pi-ov examples/aloha/eval_aloha.py \
        --robot_type mujoco_aloha \
        --task sim_transfer_cube \
        --pretrained_model_path "${models_dir}/sim_transfer_4c_chunk75" \
        --use_ov \
        --ov_model_path "${ov_models_dir}_4c_INT8" \
        --ov_device "${device}" \
        --rtc_enabled \
        --rtc_horizon 45 \
        --plot

    popd >/dev/null
}

run_collaborative_visual_slam() {
    # Select from the sample choices below.
    local sample_list=(
        "Collaborative Visual SLAM with Two Robots"
        "Collaborative Visual SLAM with FastMapping Enabled"
        "Collaborative Visual SLAM with Multi-Camera Feature"
        "Collaborative Visual SLAM with 2D Lidar Enabled"
        "Collaborative Visual SLAM with Region-wise Remapping Feature"
    )

    # Matching tutorial scripts, index-aligned with sample_list above.
    local script_list=(
        "/opt/ros/jazzy/share/collab-slam/tutorial-two-robot/cslam-two-robot.sh"
        "/opt/ros/jazzy/share/collab-slam/tutorial-fastmapping/cslam-fastmapping.sh"
        "/opt/ros/jazzy/share/collab-slam/tutorial-multi-camera/cslam-multi-camera.sh"
        "/opt/ros/jazzy/share/collab-slam/tutorial-2d-lidar/cslam-2d-lidar.sh"
        "/opt/ros/jazzy/share/collab-slam/tutorial-region-remap/cslam-region-map.sh"
    )

    select_from_menu "Select a Collaborative Visual SLAM sample:" "${sample_list[@]}"

    local i selected_script=""
    for (( i=0; i<${#sample_list[@]}; i++ )); do
        if [[ "${sample_list[$i]}" == "${SELECTED}" ]]; then
            selected_script="${script_list[$i]}"
            break
        fi
    done

    [[ -n "${selected_script}" ]] \
        || die "Invalid Collaborative Visual SLAM selection: '${SELECTED}'."
    [[ -x "${selected_script}" ]] \
        || die "Tutorial script not found or not executable: '${selected_script}'."

    log_info "Running: ${SELECTED}"
    "${selected_script}"
}

run_wandering_app_simulation() {
    log_info "Running Wandering App Simulation ..."
    ros2 launch wandering_gazebo_tutorial wandering_gazebo.launch.py
}

run_rdt_ov() {
    local device="$1"
    local venv_dir="${HUMANOID_SAMPLE_DIR}/rdt-ov/.venv"
    local rdt_ov_dir="${HUMANOID_SAMPLE_DIR}/rdt-ov"
    local sample_dir="${rdt_ov_dir}/RoboticsDiffusionTransformer"

    # shellcheck source=/dev/null
    source "${venv_dir}/bin/activate" || die "Failed to activate virtual environment at ${venv_dir}."
    pushd "${sample_dir}" >/dev/null || die "Failed to change directory to ${sample_dir}."

    log_info "Generating instruction embeddings for TransferCube-v1 ..."
    uv run python -m eval_sim.language_to_pt \
        --instruction_name "TransferCube-v1" \
        --instruction "Use the right robot arm to pick up the red cube and transfer it to the left robot arm." \
        --device cpu

    log_info "Running rdt-ov (device=${device}) ..."
    MUJOCO_GL=egl uv run python -m eval_sim.eval_rdt_aloha_static_ov \
        --env-id "TransferCube-v1" \
        --openvino_ir_path "${rdt_ov_dir}/ov_models" \
        --device "${device}" \
        --num-traj 50

    popd >/dev/null
    die "rdt-ov is not yet implemented in this launcher."
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

dispatch_sample() {
    local sample="$1" device="$2" onscreen_render="$3"
    "${SCRIPT_DIR}/install_dependencies.sh" --sample "${sample}"
    case "${sample}" in
        act-sample)                     run_act_sample "${device}" "${onscreen_render}" ;;
        pi05-rtc-ov)                    run_pi05_rtc_ov "${device}" ;;
        collaborative-visual-slam)      run_collaborative_visual_slam ;;
        wandering-app-simulation)       run_wandering_app_simulation ;;
        rdt-ov)                         run_rdt_ov "${device}" ;;
        diffusion-policy-ov)            run_diffusion_policy_ov ;;
        idp3-ov)                        run_idp3_ov ;;
        llm-robotics-demo)              run_llm_robotics_demo ;;
        mpc-demo)                       run_mpc_demo ;;
        openclaw-agenticros-demo)       run_openclaw_agenticros_demo ;;
        *)                              die "Unknown sample: '${sample}'" ;;
    esac
}

# ---------------------------------------------------------------------------
# Usage / argument parsing
# ---------------------------------------------------------------------------

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  -s, --sample  <name>   Sample to run (e.g. act-sample)
  -d, --device  <name>   OpenVINO inference device (e.g. CPU, GPU, NPU) [default: CPU]
  -r, --render           Enable onscreen rendering [default: off]
  -h, --help             Show this help message and exit

Omit any option to be prompted interactively.

Examples:
  $(basename "$0") --sample act-sample --device CPU
  $(basename "$0") --sample act-sample --device GPU --render
EOF
}

# Check if ENV SAMPLE_NAME is set, if yes, set to OPT_SAMPLE
if [[ -n "${SAMPLE_NAME:-}" ]]; then
    OPT_SAMPLE="${SAMPLE_NAME}"
else
    OPT_SAMPLE=""
fi
OPT_DEVICE=""
OPT_RENDER="yes"
IS_CLI=false   # true when at least one CLI option is provided

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -s|--sample)  OPT_SAMPLE="$2"; IS_CLI=true; shift 2 ;;
            -d|--device)  OPT_DEVICE="$2"; IS_CLI=true; shift 2 ;;
            -r|--render)  OPT_RENDER="yes"; IS_CLI=true; shift ;;
            -h|--help)    usage; exit 0 ;;
            *)            die "Unknown argument: '$1'. Run with --help for usage." ;;
        esac
    done
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    check_prerequisites
    parse_args "$@"

    # --- Resolve and validate sample (humanoid-imitation-learning) ---
    local sample="${OPT_SAMPLE}"
    if [[ -z "${sample}" ]]; then
        select_from_menu "Select a sample to launch:" "${SAMPLE_LIST[@]}"
        sample="${SELECTED}"
    fi
    contains_element "${sample}" "${SAMPLE_LIST[@]}" \
        || die "Invalid sample: '${sample}'. Valid choices: ${SAMPLE_LIST[*]}"

    log_info "Sample: ${sample}"

    # --- Resolve device and render options (act-sample only) ---
    local device="${OPT_DEVICE:-}"
    local onscreen_render="${OPT_RENDER}"

    if [[ "${sample}" == "act-sample" ]] || [[ "${sample}" == "pi05-rtc-ov" ]]; then
        if [[ -z "${device}" ]]; then
            local available_devices
            available_devices=$(/opt/venv/bin/python3 -c \
                "import openvino as ov; core = ov.Core(); print(' '.join(core.available_devices))" \
                2>/dev/null) \
                || die "Failed to query OpenVINO devices. Ensure OpenVINO is installed."
            log_info "Available OpenVINO devices: ${available_devices}"
            # shellcheck disable=SC2086
            select_from_menu --default "CPU" "Select a device (default: CPU):" ${available_devices}
            device="${SELECTED}"
        fi

        # Prompt for render only in fully interactive mode
        if [[ "${IS_CLI}" == "false" ]]; then
            # If DISPLAY="" or not set, assume no onscreen rendering
            if [[ -z "${DISPLAY:-}" ]]; then
                log_warn "DISPLAY is not set; onscreen rendering is not available."
            else
                read -rp "Enable onscreen rendering? [Y/n]: " enable_render
                export MPLBACKEND=TkAgg
                if [[ "${enable_render}" =~ ^[Nn]$ ]]; then
                    onscreen_render="no"
                    unset MPLBACKEND
                fi
            fi
        fi
    elif [[ "${sample}" == "collaborative-visual-slam" ]] || [[ "${sample}" == "wandering-app-simulation" ]]; then
        if [[ -z "${DISPLAY:-}" ]]; then
            log_error "DISPLAY is not set; onscreen rendering is required for ${sample}."
            die "Please run this script in an environment with a valid DISPLAY (e.g., X11 or Wayland)."
        fi
    else
        die "Sample '${sample}' is not yet supported in this launcher."
    fi

    device="${device:-CPU}"
    dispatch_sample "${sample}" "${device}" "${onscreen_render}"
}

main "$@"
