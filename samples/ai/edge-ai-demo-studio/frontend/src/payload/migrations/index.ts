// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as migration_20260622_065620 from './20260622_065620'

export const migrations = [
  {
    up: migration_20260622_065620.up,
    down: migration_20260622_065620.down,
    name: '20260622_065620',
  },
]
