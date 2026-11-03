// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useServiceModelCatalog } from '@/hooks/use-model-catalog'
import type { ModelOption, Service } from '@/services/types'
import type { DraftDownload } from './new-instance-summary'

/** The preset a model id names, for its label, licence gate and weight. */
export function findModelOption(
  service: Pick<Service, 'config'>,
  model: string | undefined,
): ModelOption | undefined {
  if (!model) return undefined
  return service.config?.availableModels?.find((m) => m.value === model)
}

/**
 * The model a new instance's first start would download, checked against the disk-scanned
 * catalogue. `downloaded` stays unset while loading, when unknown, or with `checkDisk` off (the
 * catalogue is polled while asked, so a long-lived page should not ask).
 */
export function useModelDownload({
  service,
  instanceKey,
  engine,
  model,
  checkDisk = true,
}: {
  service: Service
  /** The instance (or type) whose catalogue to scan. */
  instanceKey: string
  engine: string
  model: string | undefined
  checkDisk?: boolean
}): DraftDownload | undefined {
  const catalogEngine =
    engine === 'worker' || engine === 'multiserve' ? engine : undefined
  const { data: catalog } = useServiceModelCatalog(instanceKey, {
    engine: catalogEngine,
    enabled: checkDisk && Boolean(model) && catalogEngine !== undefined,
  })
  if (!model) return undefined

  const option = findModelOption(service, model)
  let downloaded: boolean | undefined
  if (catalog?.kind === 'worker') {
    downloaded = catalog.models.find((m) => m.name === model)?.downloaded
  } else if (catalog?.kind === 'multiserve') {
    const listed = [
      ...(catalog.models.openvino ?? []),
      ...(catalog.models.llamacpp ?? []),
    ].filter((m) => m.repo_id === model)
    if (listed.length > 0) {
      downloaded = listed.some((m) => m.downloaded.length > 0)
    }
  }
  return {
    label: option?.label ?? model,
    downloaded,
    large: option?.weight === 'heavy',
  }
}
