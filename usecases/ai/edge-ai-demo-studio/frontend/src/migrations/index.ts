// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as migration_20250922_083527 from './20250922_083527'

export const migrations = [
  {
    up: migration_20250922_083527.up,
    down: migration_20250922_083527.down,
    name: '20250922_083527',
  },
]
