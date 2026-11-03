// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { type ComponentType, useState } from 'react'
import { ConfigureAdvancedFoldContext } from '@/components/configure/configure-sheet'
import { useGetService } from '@/context/service-status-context'
import { engineConfigurePanels } from '@/engines/_generated/configure-panels'
import { supportsCpuAffinity } from '@/lib/instances/cpu-affinity'
import { configurePanelRegistry } from '@/services/_generated/configure-panels'
import type { Service } from '@/services/types'
import {
  getExecutionModes,
  hasExecutionMode,
  resolveExecutionMode,
} from '@/services/execution'
import { supportsCustomModels } from '@/services/model-config'
import type { HostOS } from '@/types/common'
import { EngineTabs } from './engine-tabs'
import { useDraftAwareService } from './use-draft-aware-service'
import { WorkerConfigurePanel } from './worker-configure-panel'
import type { WorkerConfigurePanelProps } from './worker-configure-panel-props'

interface ServiceConfigureDispatchProps {
  /** An instance key (e.g. "text-generation@cpu-fallback"), or a type for its primary instance. */
  serviceId: string
}

/** Resolves a service's configuration panel; takes only a string so a Server Component can render it. */
export function ServiceConfigureDispatch({
  serviceId,
}: ServiceConfigureDispatchProps) {
  const service = useGetService(serviceId)
  if (!service) return null
  return <ConfigurePanelFor service={service} />
}

/**
 * The configuration panel for a service view, including a New-instance draft no row holds yet. A
 * registered panel wins and owns its engine tabs; either way the panel gets the draft-aware view.
 */
export function ConfigurePanelFor({ service }: { service: Service }) {
  const draftService = useDraftAwareService(service)
  const RegisteredPanel = configurePanelRegistry[service.id]
  if (RegisteredPanel) return <RegisteredPanel service={draftService} />
  return <ExecutionModeConfigurePanel service={draftService} />
}

/**
 * The engine's own panel or the worker panel, with engine tabs when the service has several modes.
 * The sheet's open state and Advanced fold live here so they survive the swap between engines.
 * `workerView` lets a registered multi-engine panel adapt the view the worker panel gets, and
 * `WorkerPanel` replace that panel with its own composition of it.
 */
export function ExecutionModeConfigurePanel({
  service,
  workerView,
  WorkerPanel = WorkerConfigurePanel,
}: {
  service: Service
  workerView?: (service: Service) => Service
  WorkerPanel?: ComponentType<WorkerConfigurePanelProps>
}) {
  const [open, setOpen] = useState(false)
  const advancedFold = useState(false)
  const mode = resolveExecutionMode(service.execution, service.engine)
  const engineProps =
    getExecutionModes(service.execution).length > 1
      ? {
          engineTabs: <EngineTabs service={service} />,
          open,
          onOpenChange: setOpen,
        }
      : {}

  const EnginePanel =
    mode === 'worker' || mode === 'none'
      ? undefined
      : engineConfigurePanels[mode]
  return (
    <ConfigureAdvancedFoldContext.Provider value={advancedFold}>
      {mode === 'worker' ? (
        <WorkerPanel
          service={workerView ? workerView(service) : service}
          {...engineProps}
        />
      ) : (
        EnginePanel && <EnginePanel service={service} {...engineProps} />
      )}
    </ConfigureAdvancedFoldContext.Provider>
  )
}

/**
 * Whether `ConfigurePanelFor` has anything to show on `os`: the generic worker panel needs models
 * or Linux (for CPU affinity).
 */
export function hasConfigurePanel(service: Service, os?: HostOS): boolean {
  const modes = getExecutionModes(service.execution)
  if (modes.some((mode) => mode !== 'none' && engineConfigurePanels[mode])) {
    return true
  }
  if (!hasExecutionMode(service.execution, 'worker')) return false
  if (configurePanelRegistry[service.id]) return true
  return (
    (service.config?.availableModels?.length ?? 0) > 0 ||
    supportsCustomModels(service.config) ||
    supportsCpuAffinity(os)
  )
}
