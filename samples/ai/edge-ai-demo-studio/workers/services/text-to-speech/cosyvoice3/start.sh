#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_ROOT="$SCRIPT_DIR"
while [ "$WORKERS_ROOT" != "/" ] && [ ! -f "$WORKERS_ROOT/scripts/worker-common.sh" ]; do
    WORKERS_ROOT="$(dirname "$WORKERS_ROOT")"
done
# shellcheck source=SCRIPTDIR/../../../scripts/worker-common.sh
. "$WORKERS_ROOT/scripts/worker-common.sh"

# cosyvoice and matcha (Matcha-TTS) are vendored here (pinned in workers/upstream.json):
# upstream publishes no package.
upstream_fetch services/text-to-speech/cosyvoice3
run_worker "$@"
