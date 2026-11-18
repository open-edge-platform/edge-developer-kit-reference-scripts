#!/bin/sh
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0


set -eu

node /app/apps/web/scripts/run-production-migrations.mjs

exec "$@"