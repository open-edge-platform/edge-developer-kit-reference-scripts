#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Build the embedded bundle: a minimal (non-Electron) Edge AI Studio export with
# the Vertical Reference Solutions Blueprint injected as a studio sample, started by the studio as a
# hidden worker process — like the Edge AI suites.
#
# The work lives in scripts/bundle.mjs, shared with the Windows launchers;
# this wrapper only guarantees a usable Node. Invoked by scripts/build.sh
# (bundle args pass through), or directly. See docs/embedded-studio.md.

# shellcheck source=scripts/common.sh disable=SC1091
. "$(cd "$(dirname "$0")" && pwd)/common.sh"

require_node
exec node "$REPO_ROOT/scripts/bundle.mjs" "$@"
