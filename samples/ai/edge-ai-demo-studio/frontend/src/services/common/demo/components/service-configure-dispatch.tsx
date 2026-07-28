// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useGetService } from '@/context/service-status-context'
import { MultiserveConfigurePanel } from '@/engines/multiserve/components/configure-panel'
import { configurePanelRegistry } from '@/services/_generated/configure-panels'
import { hasExecutionMode } from '@/services/types'
import { WorkerConfigurePanel } from './worker-configure-panel'

interface ServiceConfigureDispatchProps {
  /** Service type identifier (e.g. "text-generation"). */
  serviceId: string
}

/**
 * Client component that resolves the correct configuration panel
 * based on the service's execution mode.
 *
 * - `multiserve` engine → MultiserveConfigurePanel (full backend/validation UI)
 * - `worker` mode → service-specific panel (if registered) or WorkerConfigurePanel.
 *   Worker services without `availableModels` still get a panel so users can
 *   pin CPU affinity (numactl), clear the model cache, etc.
 * - `none` mode → no panel (no process to configure)
 *
 * Accepts only a plain `serviceId` string so it can be rendered from
 * a Server Component without serialization issues.
 */
export function ServiceConfigureDispatch({
  serviceId,
}: ServiceConfigureDispatchProps) {
  const service = useGetService(serviceId)
  if (!service) return null

  if (hasExecutionMode(service.execution, 'multiserve')) {
    return <MultiserveConfigurePanel service={service} />
  }

  if (hasExecutionMode(service.execution, 'worker')) {
    const ServiceConfigurePanel = configurePanelRegistry[service.id]
    if (ServiceConfigurePanel) {
      return <ServiceConfigurePanel service={service} />
    }
    return <WorkerConfigurePanel service={service} />
  }

  return null
}
