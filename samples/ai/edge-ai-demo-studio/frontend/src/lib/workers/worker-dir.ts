// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import { WORKER_DIR } from '@/lib/constants'
import type { Service } from '@/payload-types'
import { getWorkerConfig } from '@/services/worker-registry'

/** A row's worker directory: `workers/services/<type>`, unless `data.ts` sets `workerSubDir`. */
export function resolveWorkerDir(service: Service): string {
  const subDir = getWorkerConfig(service.type)?.workerSubDir
  if (subDir) {
    return path.join(
      WORKER_DIR,
      typeof subDir === 'function' ? subDir(service) : subDir,
    )
  }
  return path.join(WORKER_DIR, 'services', service.type)
}
