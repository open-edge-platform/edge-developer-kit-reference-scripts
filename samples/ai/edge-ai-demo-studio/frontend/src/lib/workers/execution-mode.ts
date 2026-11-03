// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'
import { resolveExecutionMode } from '@/services/execution'
import type { ExecutionMode } from '@/services/types'

/**
 * The mode a `services` row runs under (`worker`, `none` or an engine id), resolved like the
 * client does: a single-mode service ignores the stored engine.
 */
export function getRowExecutionMode(
  row: Pick<Service, 'type' | 'engine'>,
): ExecutionMode {
  const meta = metaMap[row.type]
  return meta
    ? resolveExecutionMode(meta.execution, row.engine)
    : (row.engine as ExecutionMode)
}
