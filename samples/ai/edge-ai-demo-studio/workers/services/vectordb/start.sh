#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# With `--db-backend pgvector`, first fetches the OEP document-ingestion microservice (pinned in
# workers/oep-services.json); the default FAISS backend needs nothing extra.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_ROOT="$SCRIPT_DIR"
while [ "$WORKERS_ROOT" != "/" ] && [ ! -f "$WORKERS_ROOT/scripts/worker-common.sh" ]; do
    WORKERS_ROOT="$(dirname "$WORKERS_ROOT")"
done
# shellcheck source=SCRIPTDIR/../../scripts/worker-common.sh
. "$WORKERS_ROOT/scripts/worker-common.sh"

# True when this start selects the pgvector backend (flag or environment).
wants_pgvector() {
    if [ "${VECTORDB_BACKEND:-}" = "pgvector" ]; then
        return 0
    fi
    local prev=""
    for arg in "$@"; do
        if [ "$prev" = "--db-backend" ] && [ "$arg" = "pgvector" ]; then
            return 0
        fi
        if [ "$arg" = "--db-backend=pgvector" ]; then
            return 0
        fi
        prev="$arg"
    done
    return 1
}

require_uv

if wants_pgvector "$@"; then
    oep_fetch services/vectordb
fi

run_worker "$@"
