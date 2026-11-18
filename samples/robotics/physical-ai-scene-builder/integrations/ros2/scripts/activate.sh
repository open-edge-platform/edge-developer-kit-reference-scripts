#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Safe activation script for pixi.toml.
# Sources install/setup.bash when it exists (i.e., after a build).
# This avoids pixi warnings about missing activation scripts on fresh checkouts.

eval "$(register-python-argcomplete ros2)" > /dev/null

if [ -f "${PIXI_PROJECT_ROOT}/install/setup.bash" ]; then
  # shellcheck disable=SC1091
  source "${PIXI_PROJECT_ROOT}/install/setup.bash"
fi
