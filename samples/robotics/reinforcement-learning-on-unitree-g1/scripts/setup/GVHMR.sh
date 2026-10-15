#!/usr/bin/env bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/utils.sh"

GVHMR_DIR="$THIRD_PARTY_DIR/GVHMR"
GVHMR_COMMIT="ee960bb6e2ea2d381aa97f08e9b71ef320b624b1"
PYTORCH3D_DIR="$THIRD_PARTY_DIR/pytorch3d"
PYTORCH3D_COMMIT="978cd99221b9e0a6a568f1d427854d73363265cf"

# Clone and patch PyTorch3D for XPU support (GVHMR dependency)
clone_at_ref https://github.com/facebookresearch/pytorch3d.git "$PYTORCH3D_COMMIT" "$PYTORCH3D_DIR" pytorch3d-xpu
cd "$PYTORCH3D_DIR"
apply_patch_once "$PWD" "$PATCH_DIR/pytorch3d/00_rasterize_meshes_forward_xpu.patch"

# Clone GVHMR
clone_at_ref https://github.com/zju3dv/GVHMR.git "$GVHMR_COMMIT" "$GVHMR_DIR" gvhmr-xpu
cd "$GVHMR_DIR"
apply_patch_once "$PWD" "$PATCH_DIR/GVHMR/00_gvhmr_xpu_bedlam2.patch"


# Create GVHMR Python 3.10 virtual environment and download dependencies
uv venv --python 3.10
source .venv/bin/activate
uv pip install pip setuptools numpy cython
uv pip install huggingface_hub
uv pip install --no-build-isolation -r requirements.txt
uv pip install -e .

# Install patched PyTorch3D with XPU support
uv pip uninstall pytorch3d
uv pip install fvcore iopath ninja
ONEAPI_SET_VARS="${ONEAPI_ROOT:-/opt/intel/oneapi}/setvars.sh"
if [[ -f "$ONEAPI_SET_VARS" ]]; then
	source "$ONEAPI_SET_VARS" >/dev/null 2>&1 || true
fi
ICPX_BIN="$(dirname -- "$(readlink -f -- "$(command -v icpx)")")"
export PATH="$ICPX_BIN/compiler:$PATH"
command -v llvm-foreach >/dev/null 2>&1 || die "Intel SYCL linker helper llvm-foreach not found; check the oneAPI compiler installation"
TORCH_XPU_ARCH_LIST="${TORCH_XPU_ARCH_LIST:-}" PYTORCH3D_BUILD_XPU=1 uv pip install --no-build-isolation "$PYTORCH3D_DIR"

# Pin omegaconf to compatible version
uv pip install omegaconf==2.3.0

# Download huggingface checkpoints
mkdir -p inputs/checkpoints
hf download camenduru/GVHMR gvhmr/gvhmr_siga24_release.ckpt --local-dir inputs/checkpoints
hf download camenduru/GVHMR vitpose/vitpose-h-multi-coco.pth --local-dir inputs/checkpoints
hf download camenduru/GVHMR yolo/yolov8x.pt --local-dir inputs/checkpoints
hf download camenduru/GVHMR hmr2/epoch=10-step=25000.ckpt --local-dir inputs/checkpoints

# Download BEDLAM2 GVHMR models
wget -P inputs/checkpoints/gvhmr https://download.is.tue.mpg.de/bedlam2/ml/videos/gvhmr_b1.ckpt
wget -P inputs/checkpoints/gvhmr https://download.is.tue.mpg.de/bedlam2/ml/videos/gvhmr_b1b2.ckpt
wget -P inputs/checkpoints/gvhmr https://download.is.tue.mpg.de/bedlam2/ml/videos/gvhmr_b2.ckpt

# Download SIMPL and SIMPLX body models
mkdir -p inputs/checkpoints/body_models/smpl inputs/checkpoints/body_models/smplx
hf download camenduru/SMPLer-X SMPL_MALE.pkl --local-dir inputs/checkpoints/body_models/smpl
hf download camenduru/SMPLer-X SMPL_FEMALE.pkl --local-dir inputs/checkpoints/body_models/smpl
hf download camenduru/SMPLer-X SMPL_NEUTRAL.pkl --local-dir inputs/checkpoints/body_models/smpl
hf download camenduru/SMPLer-X SMPLX_MALE.npz --local-dir inputs/checkpoints/body_models/smplx
hf download camenduru/SMPLer-X SMPLX_FEMALE.npz --local-dir inputs/checkpoints/body_models/smplx
hf download camenduru/SMPLer-X SMPLX_NEUTRAL.npz --local-dir inputs/checkpoints/body_models/smplx

deactivate