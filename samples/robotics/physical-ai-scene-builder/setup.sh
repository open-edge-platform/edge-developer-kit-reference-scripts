#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

#
# Physical AI Scene Builder setup: checks prerequisites, prepares .env, installs
# dependencies, and builds the app. Start it afterwards with ./start.sh.
#
# Layout: configuration, helpers, prerequisite checks, .env handling,
# install steps, then main() at the bottom listing the steps in order.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- Configuration -----------------------------------------------------------

readonly MIN_NODE_MAJOR=20
readonly MIN_NODE_MINOR=9
readonly MIN_NPM_MAJOR=11
readonly ENV_FILE='.env'
readonly ENV_TEMPLATE='.env.example'
readonly MIN_PASSWORD_LENGTH=12
readonly PYTHON_PROJECT='integrations/python'
readonly PYTHON_EXTRAS=(--extra teleoperation --extra test --extra obj2mjcf --extra usd)
readonly TRELLIS_REPOSITORY='https://github.com/microsoft/trellis.2.git'
readonly TRELLIS_COMMIT='75fbf0183001ed9876c8dbb35de6b68552ee08bd'
readonly TRELLIS_PROJECT='services/trellis2-runtime'
readonly TRELLIS_PATCH='services/trellis2-intel-xpu.patch'
readonly TRELLIS_IMAGE_MODEL='facebook/dinov3-vitl16-pretrain-lvd1689m'

# --- Helpers -----------------------------------------------------------------

fail() {
  printf 'Setup failed: %s\n' "$1" >&2
  exit 1
}

step() {
  printf '%s\n' "$1"
}

require_command() {
  local command_name="$1" message="$2"
  command -v "$command_name" >/dev/null 2>&1 || fail "$message"
}

# Prompts without echoing input, showing '*' for all but the last typed
# character. Result is returned in $REPLY.
read_password() {
  local prompt="$1" mask_all="${2:-false}"
  local input='' character length index

  printf '%s' "$prompt"
  while IFS= read -r -s -n1 character; do
    if [[ -z "$character" ]]; then
      printf '\n'
      REPLY="$input"
      return 0
    fi

    case "$character" in
      $'\x7f'|$'\x08') input="${input%?}" ;;
      *) input+="$character" ;;
    esac

    printf '\r\033[K%s' "$prompt"
    length=${#input}
    for ((index = 1; index < length; index++)); do
      printf '%s' '*'
    done
    if ((length > 0)); then
      if [[ "$mask_all" == true ]]; then
        printf '%s' '*'
      else
        printf '%s' "${input: -1}"
      fi
    fi
  done

  fail 'Could not read password input.'
}

# Sets and exports SETUP_POSTGRES_PASSWORD (user-chosen or generated).
choose_postgres_password() {
  local password confirmation

  read_password 'Choose a PostgreSQL password (leave blank to generate one): '
  password="$REPLY"

  if [[ -z "$password" ]]; then
    SETUP_POSTGRES_PASSWORD="$(node -p "require('node:crypto').randomBytes(32).toString('base64url')")"
    step 'Generated a secure PostgreSQL password.'
  else
    [[ ${#password} -ge $MIN_PASSWORD_LENGTH ]] || fail "Use at least $MIN_PASSWORD_LENGTH characters for the PostgreSQL password."
    [[ "$password" =~ ^[A-Za-z0-9._~-]+$ ]] || fail 'Use only letters, numbers, dots, underscores, hyphens, and tildes in the PostgreSQL password.'

    read_password 'Confirm PostgreSQL password: '
    confirmation="$REPLY"
    [[ "$password" == "$confirmation" ]] || fail 'The PostgreSQL passwords do not match.'
    SETUP_POSTGRES_PASSWORD="$password"
    unset confirmation
  fi

  export SETUP_POSTGRES_PASSWORD
  unset password
}

# --- Prerequisite checks -----------------------------------------------------

check_node() {
  require_command node "Node.js ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} or newer is required."
  node -e "
    const [major, minor] = process.versions.node.split('.').map(Number);
    process.exit(major > $MIN_NODE_MAJOR || (major === $MIN_NODE_MAJOR && minor >= $MIN_NODE_MINOR) ? 0 : 1);
  " || fail "Node.js $(node --version) is too old; install Node.js ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} or newer."
}

check_npm() {
  require_command npm 'npm is required.'
  local major
  major="$(npm --version | cut -d. -f1)"
  if [[ ! "$major" =~ ^[0-9]+$ ]] || ((major < MIN_NPM_MAJOR)); then
    fail "npm $(npm --version) is too old; install npm ${MIN_NPM_MAJOR} or newer."
  fi
}

check_docker() {
  require_command docker 'Docker CLI is required. Install Docker with Docker Compose.'
  docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required (docker compose).'
  docker info >/dev/null 2>&1 || fail 'Docker is not running or the current user cannot access the Docker daemon.'
}

check_uv() {
  require_command uv 'uv is required. Install it from https://docs.astral.sh/uv/.'
}

prepare_trellis_source() {
  local checkout="$TRELLIS_PROJECT"
  local patch_file="$SCRIPT_DIR/$TRELLIS_PATCH"
  local marker="$checkout/.intel-xpu-patch.sha256"
  local patch_hash actual_commit='' actual_patch_hash=''
  local parent temp_dir worktree

  [[ -f "$patch_file" ]] || fail "Missing TRELLIS.2 patch file: $TRELLIS_PATCH"
  patch_hash="$(git hash-object "$patch_file")"

  if [[ -d "$checkout/.git" ]]; then
    actual_commit="$(git -C "$checkout" rev-parse HEAD 2>/dev/null || true)"
    if [[ -f "$marker" ]]; then
      IFS= read -r actual_patch_hash < "$marker" || true
    fi
    if [[ "$actual_commit" == "$TRELLIS_COMMIT" && "$actual_patch_hash" == "$patch_hash" ]]; then
      step 'Using the existing pinned, Intel-patched TRELLIS.2 checkout.'
      return
    fi
    fail "An incompatible TRELLIS.2 checkout already exists at $checkout; move it aside and re-run setup."
  fi

  [[ ! -e "$checkout" ]] || fail "TRELLIS.2 runtime path already exists and is not a Git checkout: $checkout"

  parent="${checkout%/*}"
  mkdir -p "$parent"
  temp_dir="$(mktemp -d "$parent/.trellis2-setup.XXXXXX")" || fail 'Could not create a temporary TRELLIS.2 checkout directory.'
  worktree="$temp_dir/checkout"

  if ! (
    git init --quiet "$worktree" \
      && git -C "$worktree" remote add origin "$TRELLIS_REPOSITORY" \
      && git -C "$worktree" fetch --quiet --depth 1 origin "$TRELLIS_COMMIT" \
      && git -C "$worktree" checkout --quiet --detach FETCH_HEAD \
      && git -C "$worktree" submodule update --init --recursive \
      && git -C "$worktree" apply --check --whitespace=fix "$patch_file" \
      && git -C "$worktree" apply --whitespace=fix "$patch_file" \
      && printf '%s\n' "$patch_hash" > "$worktree/.intel-xpu-patch.sha256"
  ); then
    rm -rf -- "$temp_dir"
    fail 'Could not fetch and prepare the pinned TRELLIS.2 source. Check network access and the patch bundle.'
  fi

  if ! mv -- "$worktree" "$checkout"; then
    rm -rf -- "$temp_dir"
    fail "Could not install the TRELLIS.2 checkout at $checkout."
  fi
  rmdir -- "$temp_dir"
  step "Prepared Intel-patched TRELLIS.2 at $checkout."
}

# Reports each package as [ok]/[missing]; appends missing apt package names
# to the global MISSING_PACKAGES array.
report_package() {
  local package="$1" description="$2" found="$3"
  if [[ "$found" == true ]]; then
    printf '  [ok]      %s\n' "$description"
  else
    printf '  [missing] %s\n' "$description"
    MISSING_PACKAGES+=("$package")
  fi
}

check_system_packages() {
  MISSING_PACKAGES=()
  local python_include=''

  step 'Checking system build dependencies...'

  if command -v gcc >/dev/null 2>&1 && command -v g++ >/dev/null 2>&1 && command -v make >/dev/null 2>&1; then
    report_package build-essential 'build-essential (gcc, g++, make)' true
  else
    report_package build-essential 'build-essential (gcc, g++, and make are required)' false
  fi

  if command -v pkg-config >/dev/null 2>&1; then
    report_package pkg-config 'pkg-config' true
  else
    report_package pkg-config 'pkg-config' false
  fi

  if command -v python3 >/dev/null 2>&1 \
    && python_include="$(python3 -c 'import sysconfig; print(sysconfig.get_paths()["include"])' 2>/dev/null)" \
    && [[ -f "$python_include/Python.h" ]]; then
    report_package python3-dev "python3-dev (Python.h found in $python_include)" true
  else
    report_package python3-dev 'python3-dev (python3 headers, Python.h, not found)' false
  fi

  if ((${#MISSING_PACKAGES[@]} > 0)); then
    printf '\nMissing system packages: %s\n' "${MISSING_PACKAGES[*]}" >&2
    printf 'Install them with:\n\n  sudo apt-get update && sudo apt-get install -y %s\n\n' "${MISSING_PACKAGES[*]}" >&2
    printf 'On non-Debian distributions, install the equivalent packages, then re-run ./setup.sh.\n' >&2
    fail 'install the missing system packages listed above and re-run setup.'
  fi
}

# Optional: the v4l2loopback kernel module backs Simulate > Virtual cameras. Only the host can
# install or load a kernel module (a container cannot), so this reports what to run and never
# fails setup; everything else works without it.
check_virtual_camera_driver() {
  step 'Checking the optional virtual camera driver (v4l2loopback)...'
  if [[ -e /dev/v4l2loopback ]]; then
    printf '  [ok]      v4l2loopback loaded\n'
  elif modinfo v4l2loopback >/dev/null 2>&1; then
    printf '  [off]     v4l2loopback is installed but not loaded; virtual cameras need it. Load it now\n'
    printf '            and at every boot with:\n\n'
    printf '  sudo modprobe v4l2loopback\n'
    printf '  echo v4l2loopback | sudo tee /etc/modules-load.d/v4l2loopback.conf\n\n'
  else
    printf '  [missing] v4l2loopback (optional: only virtual cameras need it). Install and load it with:\n\n'
    printf '  sudo apt-get update && sudo apt-get install -y v4l2loopback-dkms\n'
    printf '  sudo modprobe v4l2loopback\n'
    printf '  echo v4l2loopback | sudo tee /etc/modules-load.d/v4l2loopback.conf\n\n'
  fi
}

check_prerequisites() {
  check_node
  check_npm
  check_docker
  check_uv
  require_command git 'Git is required to fetch the TRELLIS.2 source.'
  check_system_packages
  check_virtual_camera_driver
}

# --- Root .env handling ------------------------------------------------------

# Prints the value of POSTGRES_PASSWORD in the given env file (empty if unset).
read_env_password() {
  local line
  line="$(grep -m1 '^POSTGRES_PASSWORD=' "$1" || true)"
  line="${line#POSTGRES_PASSWORD=}"
  line="${line%$'\r'}"
  # Trim surrounding whitespace.
  line="${line#"${line%%[![:space:]]*}"}"
  printf '%s' "${line%"${line##*[![:space:]]}"}"
}

# Exit status: 0 = password set, 2 = missing or placeholder, other = read error.
# The template's value is the placeholder; a .env still holding it is unconfigured.
env_password_status() {
  local configured template_default
  configured="$(read_env_password "$ENV_FILE")" || return 1
  template_default="$(read_env_password "$ENV_TEMPLATE")" || return 1
  if [[ -z "$configured" || "$configured" == "$template_default" ]]; then
    return 2
  fi
}

create_env_from_template() {
  [[ -f "$ENV_TEMPLATE" ]] || fail "Missing $ENV_TEMPLATE; cannot initialize the root $ENV_FILE file."
  choose_postgres_password
  node <<NODE
const fs = require('node:fs');

const template = fs.readFileSync('$ENV_TEMPLATE', 'utf8');
if (!/^POSTGRES_PASSWORD=.*\$/m.test(template)) {
  console.error('Missing POSTGRES_PASSWORD setting in $ENV_TEMPLATE.');
  process.exit(1);
}

const env = template
  .replace(/^POSTGRES_PASSWORD=.*\$/m, \`POSTGRES_PASSWORD=\${process.env.SETUP_POSTGRES_PASSWORD}\`)
  .replace(/^PAYLOAD_SECRET=[ \\t]*\$/m, \`PAYLOAD_SECRET=\${require('node:crypto').randomBytes(32).toString('base64url')}\`);
fs.writeFileSync('$ENV_FILE', env, { flag: 'wx', mode: 0o600 });
NODE
  step "Created root $ENV_FILE with the selected PostgreSQL password and a generated PAYLOAD_SECRET."
}

update_env_password() {
  choose_postgres_password
  node <<NODE
const fs = require('node:fs');

const env = fs.readFileSync('$ENV_FILE', 'utf8');
const setting = \`POSTGRES_PASSWORD=\${process.env.SETUP_POSTGRES_PASSWORD}\`;
const updated = /^POSTGRES_PASSWORD=.*\$/m.test(env)
  ? env.replace(/^POSTGRES_PASSWORD=.*\$/m, setting)
  : \`\${env.replace(/\\s*\$/, '')}\\n\${setting}\\n\`;
fs.writeFileSync('$ENV_FILE', updated);
NODE
  step "Updated POSTGRES_PASSWORD in the root $ENV_FILE file."
}

# Fills an empty or missing PAYLOAD_SECRET in an existing root .env.
ensure_payload_secret() {
  SETUP_ENV_FILE="$ENV_FILE" node <<'NODE'
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');

const file = process.env.SETUP_ENV_FILE;
const env = fs.readFileSync(file, 'utf8');
if (/^PAYLOAD_SECRET=[ \t]*\S/m.test(env)) process.exit(0);

const setting = `PAYLOAD_SECRET=${randomBytes(32).toString('base64url')}`;
const updated = /^PAYLOAD_SECRET=.*$/m.test(env)
  ? env.replace(/^PAYLOAD_SECRET=.*$/m, setting)
  : `${env.replace(/\s*$/, '')}\n${setting}\n`;
fs.writeFileSync(file, updated);
console.log(`Generated PAYLOAD_SECRET in the root ${file} file.`);
NODE
}

ensure_root_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    create_env_from_template
    return
  fi

  local status=0
  env_password_status || status=$?
  case "$status" in
    0) step "Using existing root $ENV_FILE." ;;
    2) update_env_password ;;
    *) fail "Could not read the root $ENV_FILE file." ;;
  esac
  ensure_payload_secret
  chmod 600 -- "$ENV_FILE"
}

# --- Install and build steps -------------------------------------------------

download_trellis_image_model() {
  local token="${HF_TOKEN:-}"

  if HF_HUB_OFFLINE=1 uv tool run --from huggingface-hub hf download "$TRELLIS_IMAGE_MODEL" --quiet >/dev/null 2>&1; then
    step 'Using the DINOv3 model already in the Hugging Face cache.'
    return
  fi

  step 'TRELLIS.2 requires the gated DINOv3 model for 3D generation.'
  step "Request access and accept the model terms at https://huggingface.co/$TRELLIS_IMAGE_MODEL"
  step 'Create a read token with access to this model at https://huggingface.co/settings/tokens'
  step 'The token will only be used to download the model into your Hugging Face cache; setup will not save it.'

  if [[ -z "$token" ]]; then
    [[ -t 0 ]] || fail 'Set HF_TOKEN to a token with approved DINOv3 access when running setup non-interactively.'
    read_password 'Hugging Face token (masked): ' true
    token="$REPLY"
    unset REPLY
    [[ -n "$token" ]] || fail 'A Hugging Face token with approved DINOv3 access is required.'
  fi

  step 'Downloading DINOv3 before starting the 3D generation service (cached files are reused)...'
  HF_TOKEN="$token" uv tool run --from huggingface-hub hf download "$TRELLIS_IMAGE_MODEL" \
    || fail "Could not download DINOv3. Check your network connection, token permissions, and approved access at https://huggingface.co/$TRELLIS_IMAGE_MODEL, then re-run ./setup.sh."
}

prepare_web_env() {
  step 'Preparing the local web environment...'
  node apps/web/scripts/ensure-local-env.mjs --sync-database
  chmod 600 -- apps/web/.env
}

install_npm_dependencies() {
  step 'Installing npm dependencies...'
  npm install
}

install_python_environment() {
  step 'Installing the Python environment for Generate and Evaluate...'
  uv sync --project "$PYTHON_PROJECT" "${PYTHON_EXTRAS[@]}"
}

build_app() {
  step 'Building Physical AI Scene Builder...'
  npm run build
}

# --- Main --------------------------------------------------------------------

main() {
  check_prerequisites
  download_trellis_image_model
  prepare_trellis_source
  ensure_root_env
  prepare_web_env
  install_npm_dependencies
  install_python_environment
  build_app
  step 'Setup complete. Start Physical AI Scene Builder with ./start.sh.'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
