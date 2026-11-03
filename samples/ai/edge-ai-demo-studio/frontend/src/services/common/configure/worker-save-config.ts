// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfigUpdate } from '@/hooks/use-service-config'
import type { ModelSource } from '@/types/common'

/**
 * What a worker panel's Save sends: its model fields, the extension's config and one merged
 * `metadata`. The server replaces the stored model, so a precision is sent even when unchanged.
 */
export function workerSaveConfig({
  model,
  extension,
  cpuAffinity,
}: {
  /** The panel's model; unset when a `modelSection` replaces it. */
  model?: {
    name: string
    device: string
    source?: ModelSource
    quant?: string
  }
  extension?: ServiceConfigUpdate
  /** The normalized CPU affinity, set only when it changed. */
  cpuAffinity?: string
}): ServiceConfigUpdate {
  const { metadata: extensionMetadata, ...extensionConfig } = extension ?? {}
  const metadata = {
    ...extensionMetadata,
    ...(cpuAffinity !== undefined && { cpuAffinity }),
  }
  return {
    ...(model && {
      name: model.name,
      device: model.device,
      ...(model.source !== undefined && { source: model.source }),
      ...(model.quant !== undefined && { quant: model.quant }),
    }),
    ...extensionConfig,
    ...(Object.keys(metadata).length > 0 && { metadata }),
  }
}
