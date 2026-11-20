#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -e

# Global variables
# The uv workers/setup.sh installs, from a checked download; never a fetched install script.
UV_EXE="${UV_PATH:-../../thirdparty/uv/uv}"
VENV_ACTIVATE_SCRIPT="../../.venv/bin/activate"

# The root setup.sh saves the backend (sycl or vulkan) to .llamacpp-backend; run standalone, that file
# or LLAMACPP_BACKEND decides, defaulting to vulkan.
MULTISERVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$MULTISERVE_DIR/../../.." && pwd)"

# Shared helpers: scripts/bash/ in the repo, scripts/ in a packaged build.
for helper_dir in "$REPO_ROOT/scripts/bash" "$REPO_ROOT/scripts"; do
    if [ -f "$helper_dir/llamacpp_backend.sh" ]; then
        # shellcheck source=SCRIPTDIR/../../../scripts/bash/llamacpp_backend.sh
        source "$helper_dir/llamacpp_backend.sh"
    fi
    if [ -f "$helper_dir/thirdparty_integrity.sh" ]; then
        # Checked downloads and install manifests.
        # shellcheck source=SCRIPTDIR/../../../scripts/bash/thirdparty_integrity.sh
        source "$helper_dir/thirdparty_integrity.sh"
        break
    fi
done
if ! command -v install_verified_archive >/dev/null 2>&1; then
    echo "**ERROR:** thirdparty_integrity.sh not found next to the project's setup scripts."
    exit 1
fi

# Each download is checked against the SHA-256 beside its URL (GitHub's digest of the release asset).
if command -v lb_load_config >/dev/null 2>&1; then
    lb_load_config || true
    LLAMA_RELEASE_URL="$(lb_llamacpp_url "$LLAMACPP_BACKEND" "$LLAMACPP_SYCL_PRECISION")"
    LLAMA_SHA256="$(lb_llamacpp_sha256 "$LLAMACPP_BACKEND" "$LLAMACPP_SYCL_PRECISION")" || LLAMA_SHA256=""
    LLAMA_EXTRACT_DIR="engine/$(lb_engine_dir "$LLAMACPP_BACKEND")"
else
    # Helper missing (unexpected): fall back to the Vulkan build.
    LLAMACPP_BACKEND="vulkan"
    LLAMACPP_SYCL_PRECISION="fp16"
    LLAMACPP_VERSION="b11540"
    LLAMA_RELEASE_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMACPP_VERSION}/llama-${LLAMACPP_VERSION}-bin-ubuntu-vulkan-x64.tar.gz"
    LLAMA_SHA256="d639b4b98d0c028e17ace64caaa9b881937b98da433840efd0316d560ee92e8f"
    LLAMA_EXTRACT_DIR="engine/llama.cpp-vulkan"
fi

# The unselected backend's build, removed so only one exists (LlamaCPPManager takes whichever it finds).
if [ "$LLAMACPP_BACKEND" = "sycl" ]; then
    LLAMA_OTHER_EXTRACT_DIR="engine/llama.cpp-vulkan"
else
    LLAMA_OTHER_EXTRACT_DIR="engine/llama.cpp-sycl"
fi

# Optional, built by setup_thirdparty.sh: checks the llama.cpp context against free GPU memory.
QMASSA_PATH="../../../thirdparty/qmassa/bin/qmassa"

GGUF_PARSER_RELEASE_URL="https://github.com/gpustack/gguf-parser-go/releases/download/v0.22.1/gguf-parser-linux-amd64"
GGUF_PARSER_SHA256="50e61732864d37f881c87e3912fba12a928706d33d9d8ae9cd0abacaade82a71"
GGUF_PARSER_BINARY_NAME="gguf-parser"
GGUF_PARSER_INSTALL_DIR="engine"

SHARED_OVMS_DIR="../../thirdparty/ovms"
# The uv the workers run with (worker-common.sh); it wrote workers/uv.lock.
SHARED_UV_EXE="../../thirdparty/uv/uv"
# The optimum-cli environment `ovms --pull` converts with; ovms_prepare (start.sh) builds it on first start.
SHARED_OVMS_EXPORT_VENV="../../common/ovms-export/.venv"

# Utility functions
print_step() {
    echo ""
    echo "## $1"
}

print_success() {
    echo "**SUCCESS:** $1"
}

print_error() {
    echo "**ERROR:** $1"
}

print_warning() {
    echo "**WARNING:** $1"
}

is_executable() {
    [[ -f "$1" && -x "$1" ]]
}

# Installation functions
install_uv() {
    print_step "1. uv"

    if ! is_executable "$UV_EXE"; then
        print_error "uv not found at $UV_EXE."
        print_error "Please run workers/setup.sh first to download the shared uv."
        return 1
    fi
    print_success "uv found at $UV_EXE"
    return 0
}

# Remove the unselected backend's build, so switching SYCL/Vulkan doesn't leave both on disk.
# The Docker image keeps both (LLAMACPP_KEEP_OTHER_BUILD=true) and picks one at container start.
remove_unused_llamacpp() {
    if [[ "${LLAMACPP_KEEP_OTHER_BUILD:-false}" == "true" ]]; then
        return 0
    fi
    if [[ -d "$LLAMA_OTHER_EXTRACT_DIR" ]]; then
        echo "Removing llama.cpp build for the unselected backend: $LLAMA_OTHER_EXTRACT_DIR"
        rm -rf "$LLAMA_OTHER_EXTRACT_DIR"
    fi
}

install_llamacpp() {
    print_step "2. Llama.cpp Download and Extraction"

    if [ "$LLAMACPP_BACKEND" = "sycl" ]; then
        echo "Backend: $LLAMACPP_BACKEND ($LLAMACPP_SYCL_PRECISION)"
    else
        echo "Backend: $LLAMACPP_BACKEND"
    fi
    echo "Release: $LLAMA_RELEASE_URL"

    if [[ -z "$LLAMA_SHA256" ]]; then
        print_error "No SHA-256 is pinned for llama.cpp $LLAMACPP_VERSION ($LLAMACPP_BACKEND); add it to lb_llamacpp_sha256 in llamacpp_backend.sh."
        return 1
    fi

    # Staged beside the target and swapped in once checked, so the build in use stays intact until
    # then; the manifest records the archive (backend and precision included), so a switch
    # re-downloads. LlamaCPPManager resolves the exact engine path, so it never picks up the staging
    # directory.
    if ! install_verified_archive --after has_llamacpp_binaries "llama.cpp ($LLAMACPP_BACKEND)" \
        "$LLAMA_RELEASE_URL" "$LLAMA_SHA256" "$LLAMA_EXTRACT_DIR"; then
        return 1
    fi

    # Only now is it safe to drop the other backend's build.
    remove_unused_llamacpp

    print_success "Llama.cpp extraction complete."
    return 0
}

# has_llamacpp_binaries <dir> -- whether the extracted release holds llama.cpp's programs.
has_llamacpp_binaries() {
    if [[ "$(find "$1" -name 'llama-*' -type f | wc -l)" -eq 0 ]]; then
        print_error "The downloaded archive contains no llama.cpp binaries."
        return 1
    fi
}

# Install the runtime the SYCL build links against: the llamacpp-sycl group of
# the shared worker environment, in place of the Intel oneAPI Toolkit.
install_sycl_runtime() {
    [ "$LLAMACPP_BACKEND" = "sycl" ] || return 0
    print_step "2b. SYCL Runtime"

    if ! command -v lb_install_sycl_runtime >/dev/null 2>&1; then
        print_error "The llama.cpp backend helper is unavailable."
        return 1
    fi

    local uv="$UV_EXE"
    if is_executable "$SHARED_UV_EXE"; then
        uv="$SHARED_UV_EXE"
    fi
    if ! lb_install_sycl_runtime "$uv"; then
        print_error "Failed to install the SYCL runtime into $LLAMACPP_SYCL_RUNTIME_DIR."
        return 1
    fi
    print_success "SYCL runtime installed in $LLAMACPP_SYCL_RUNTIME_DIR"
    return 0
}

install_gguf_parser() {
    print_step "4. GGUF Parser Installation"
    
    local gguf_parser_path="$GGUF_PARSER_INSTALL_DIR/$GGUF_PARSER_BINARY_NAME"

    if ! install_verified_file "GGUF Parser" "$GGUF_PARSER_RELEASE_URL" "$GGUF_PARSER_SHA256" "$gguf_parser_path"; then
        return 1
    fi

    if is_executable "$gguf_parser_path"; then
        print_success "GGUF Parser installed successfully at $gguf_parser_path"
    else
        print_error "GGUF Parser installation failed - binary is not executable."
        return 1
    fi
    
    return 0
}

provision_ovms() {
    print_step "5. OVMS Shared Thirdparty Setup"

    if [[ ! -f "$SHARED_OVMS_DIR/bin/ovms" ]]; then
        print_error "Shared OVMS binary not found at $SHARED_OVMS_DIR/bin/ovms."
        print_error "Please run workers/setup.sh first to download the shared OVMS package."
        return 1
    fi
    print_success "Shared OVMS found at $SHARED_OVMS_DIR/bin/ovms"

    # OVMS needs Jinja2/MarkupSafe in its lib/python to serve models.
    local OVMS_LIB_PYTHON_DIR="$SHARED_OVMS_DIR/lib/python"
    if [[ -d "$OVMS_LIB_PYTHON_DIR/jinja2" && -d "$OVMS_LIB_PYTHON_DIR/markupsafe" ]]; then
        print_success "Jinja2 already installed in OVMS lib/python. Skipping."
    else
        echo "Installing Jinja2 and MarkupSafe into OVMS lib/python: $OVMS_LIB_PYTHON_DIR"
        if ! "$UV_EXE" pip install --target "$OVMS_LIB_PYTHON_DIR" "Jinja2==3.1.6" "MarkupSafe==3.0.2"; then
            print_error "Failed to install Jinja2/MarkupSafe into OVMS lib/python."
            return 1
        fi
        print_success "Jinja2/MarkupSafe installed into OVMS lib/python."
    fi

    # optimum-cli alone is not enough: a sync stopped partway leaves the entry
    # point without its packages. find_spec checks them without importing.
    if [[ -x "$SHARED_OVMS_EXPORT_VENV/bin/optimum-cli" ]] \
        && "$SHARED_OVMS_EXPORT_VENV/bin/python" -I -c "import importlib.util, sys; sys.exit(any(importlib.util.find_spec(m) is None for m in sys.argv[1:]))" \
            optimum openvino transformers torch >/dev/null 2>&1; then
        print_success "OVMS conversion environment found at $SHARED_OVMS_EXPORT_VENV."
    elif [[ -x "$SHARED_OVMS_EXPORT_VENV/bin/optimum-cli" ]]; then
        print_warning "OVMS conversion environment at $SHARED_OVMS_EXPORT_VENV is incomplete (an earlier install did not finish)."
        print_warning "The conversion environment will be synced when multiserve or an OVMS worker starts."
    else
        print_warning "OVMS conversion environment not found at $SHARED_OVMS_EXPORT_VENV."
        print_warning "The conversion environment will be synced when multiserve or an OVMS worker starts."
    fi
}

verify_installations() {
    print_step "7. Verification"

    local verification_failed=false

    if is_executable "$UV_EXE"; then
        print_success "uv: OK"
    else
        print_error "uv: FAILED"
        verification_failed=true
    fi
    
    local llama_bin_count
    llama_bin_count=$(find "$LLAMA_EXTRACT_DIR" -name 'llama-*' -type f 2>/dev/null | wc -l)
    if [[ $llama_bin_count -gt 0 ]]; then
        print_success "Llama.cpp ($LLAMACPP_BACKEND): OK ($llama_bin_count binaries found)"
    else
        print_error "Llama.cpp ($LLAMACPP_BACKEND): FAILED (no binaries found)"
        verification_failed=true
    fi

    # For SYCL, check the runtime wheels satisfy the binaries: the release ships only the backend,
    # so a version mismatch shows up as unresolved libraries or symbols.
    if [[ "$LLAMACPP_BACKEND" == "sycl" && $llama_bin_count -gt 0 ]]; then
        if ! command -v lb_verify_sycl_runtime >/dev/null 2>&1; then
            print_warning "SYCL runtime: SKIPPED (backend helper unavailable)"
        elif lb_verify_sycl_runtime "$LLAMA_EXTRACT_DIR/libggml-sycl.so"; then
            print_success "SYCL runtime: OK"
        else
            print_error "SYCL runtime: FAILED (see above)"
            echo "The runtime in $LLAMACPP_SYCL_RUNTIME_DIR must provide what llama.cpp $LLAMACPP_VERSION was built against."
            verification_failed=true
        fi
    fi
    
    if is_executable "$QMASSA_PATH"; then
        print_success "qmassa: OK"
    else
        print_warning "qmassa: not installed (context sizes are not checked against free GPU memory)"
    fi
    
    if is_executable "$GGUF_PARSER_INSTALL_DIR/$GGUF_PARSER_BINARY_NAME"; then
        print_success "GGUF Parser: OK"
    else
        print_error "GGUF Parser: FAILED"
        verification_failed=true
    fi
    
    if [[ -f "$SHARED_OVMS_DIR/bin/ovms" ]]; then
        print_success "OVMS: OK"
    else
        print_error "OVMS: FAILED"
        verification_failed=true
    fi
    
    if [[ -f "$VENV_ACTIVATE_SCRIPT" ]]; then
        print_success "Python Virtual Environment: OK"
    else
        print_error "Python Virtual Environment: FAILED"
        verification_failed=true
    fi
    
    if [[ "$verification_failed" == "true" ]]; then
        print_error "Some components failed verification. Please check the logs above."
        return 1
    else
        print_success "All components verified successfully!"
        return 0
    fi
}

print_final_instructions() {
    echo ""
    echo "**All setup tasks completed successfully!**"
    echo ""
    echo "----------------------------------------------------------------------"
    echo "**NEXT STEP:** The development environment is ready."
    echo "To **ACTIVATE** the Python environment in this terminal, run:"
    echo ""
    echo "    source $VENV_ACTIVATE_SCRIPT"
    echo ""
    echo "After activation, you can run: python app.py"
    echo ""
    echo "**Available Tools:**"
    echo "  • Llama.cpp ($LLAMACPP_BACKEND) binaries: $LLAMA_EXTRACT_DIR/"
    if [ "$LLAMACPP_BACKEND" = "sycl" ]; then
        echo "    SYCL precision: $LLAMACPP_SYCL_PRECISION"
        echo "    This engine's start.sh puts its runtime ($LLAMACPP_SYCL_RUNTIME_DIR) on LD_LIBRARY_PATH on every launch."
    fi
    echo "  • GGUF Parser: $GGUF_PARSER_INSTALL_DIR/$GGUF_PARSER_BINARY_NAME"
    echo "  • OVMS: $SHARED_OVMS_DIR/bin/ovms"
    if is_executable "$QMASSA_PATH"; then
        echo "  • qmassa: $QMASSA_PATH"
    fi
    echo "----------------------------------------------------------------------"
}

main() {
    echo ""
    echo "=== Project Setup Script (Enhanced with Functions) ==="
    echo ""

    install_uv || exit 1
    install_llamacpp || exit 1
    install_sycl_runtime || exit 1
    install_gguf_parser || exit 1
    provision_ovms || exit 1

    verify_installations || exit 1

    print_final_instructions
}

main "$@"
