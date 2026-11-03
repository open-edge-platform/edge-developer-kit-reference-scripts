// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'

/** Whether `value` names a service type this build has (a key of `metaMap`). */
export function isServiceType(value: unknown): value is Service['type'] {
  return typeof value === 'string' && Object.hasOwn(metaMap, value)
}
