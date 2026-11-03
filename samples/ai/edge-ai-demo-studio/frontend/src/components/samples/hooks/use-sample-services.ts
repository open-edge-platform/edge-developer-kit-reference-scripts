// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useSampleInstances } from '@/context/sample-instances-context'
import {
  useServiceActivity,
  useServiceStatus,
} from '@/context/service-status-context'
import { useSystemInfo } from '@/context/system-info-context'
import { useSampleSettingsState } from '@/hooks/use-sample-settings'
import {
  computeSampleReadinessView,
  type SampleReadinessView,
} from '@/samples/common/readiness'
import type { Sample } from '@/samples/types'
import type { Service } from '@/services/types'
import { useReadinessFlags } from './use-readiness-flags'

export interface SampleServices {
  view: SampleReadinessView
  /** Resolved service views of every dependency that has a record, required first. */
  allServices: Service[]
  /** Reloads whatever failed (service status, bindings, device check) and nothing else. */
  retry: () => void
  /** A refresh is running (service status; binding and device refetches are quick). */
  retrying: boolean
}

/**
 * Resolves a sample's dependencies against live service status, each through its bound instance,
 * else its type's primary instance.
 */
export function useSampleServices(sample: Sample): SampleServices {
  const { serviceById, connectionError, refreshServices } = useServiceStatus()
  const { refreshing } = useServiceActivity()
  const bindings = useSampleInstances()?.bindings
  const flags = useReadinessFlags()
  const {
    unavailable: bindingsUnavailable,
    stale: bindingsStale,
    retry: retryBindings,
  } = useSampleSettingsState()
  const { error: systemError, retry: retrySystemInfo } = useSystemInfo()

  const retry = () => {
    if (connectionError) refreshServices()
    if (bindingsUnavailable || bindingsStale) retryBindings()
    if (systemError) retrySystemInfo()
  }

  const view = computeSampleReadinessView(sample, {
    ...flags,
    resolve: (type) => serviceById.get(bindings?.[type] ?? type),
    typeView: (type) => serviceById.get(type),
    boundKey: (type) => bindings?.[type],
  })
  const deps = [...view.required, ...view.optional]
  return {
    view,
    allServices: deps.flatMap((d) => (d.service ? [d.service] : [])),
    retry,
    retrying: refreshing,
  }
}
