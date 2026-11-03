// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { engines } from '@/engines/registry'
import type { Service } from '@/services/types'
import { getEffectiveModel } from '@/types/service'

/**
 * The model name to send in requests: multiserve services prefix the backend (`openvino:<id>`) when
 * `inference` is set; workers use the stored name as is.
 */
export function getServiceModelName(
  service: Service,
  inference = false,
): string | undefined {
  const { name, device, backend, quant } = getEffectiveModel(service)
  if (!name) return undefined

  const engine = service.engine ? engines[service.engine] : undefined
  if (!engine) return name

  return engine.getModelName({ name, device, backend, quant }, inference)
}
