#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Starts Local Lingua via Docker Compose. The image is already built by
# setup.sh, so this is fast on repeat runs. Thin wrapper around `make run`
# (pass REBUILD=1 to force a rebuild, e.g. after changing the source).
# Run ./setup.sh first on a fresh machine.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

make run
