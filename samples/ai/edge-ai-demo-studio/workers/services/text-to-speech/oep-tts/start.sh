#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Text-to-speech worker for models without a built-in worker: the OEP text-to-speech
# microservice, fetched at the tag pinned in workers/oep-services.json.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_ROOT="$SCRIPT_DIR"
while [ "$WORKERS_ROOT" != "/" ] && [ ! -f "$WORKERS_ROOT/scripts/worker-common.sh" ]; do
    WORKERS_ROOT="$(dirname "$WORKERS_ROOT")"
done
# shellcheck source=SCRIPTDIR/../../../scripts/worker-common.sh
. "$WORKERS_ROOT/scripts/worker-common.sh"

require_uv
oep_fetch services/text-to-speech/oep-tts

run_oep_worker "$@"
