#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

KIOSK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export KIOSK_DIR
exec "$KIOSK_DIR/../common/start.sh" "$@"
