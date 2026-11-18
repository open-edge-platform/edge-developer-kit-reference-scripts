#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0


set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  printf 'Root .env is missing. Run ./setup.sh first.\n' >&2
  exit 1
fi

if ! grep -Eq '^POSTGRES_PASSWORD=.+$' .env; then
  printf 'Root .env must contain a non-empty POSTGRES_PASSWORD. Run ./setup.sh or update .env.\n' >&2
  exit 1
fi

exec npm run start
