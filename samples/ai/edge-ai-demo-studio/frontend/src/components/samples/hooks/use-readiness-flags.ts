// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useServiceStatus } from '@/context/service-status-context'
import { useSystemInfo } from '@/context/system-info-context'
import { useSampleSettingsState } from '@/hooks/use-sample-settings'
import type { SampleReadinessInputs } from '@/samples/common/readiness'

export type ReadinessFlags = Pick<
  SampleReadinessInputs,
  | 'statusLoading'
  | 'statusUnavailable'
  | 'statusStale'
  | 'bindingsUnavailable'
  | 'bindingsStale'
  | 'systemInfo'
  | 'systemLoading'
  | 'systemUnavailable'
>

/**
 * Loading/availability flags every readiness view shares: service status, system info and instance
 * bindings. Failures are carried through (e.g. a failed device check means `unverified`, not compatible).
 */
export function useReadinessFlags(): ReadinessFlags {
  const { loading, connectionError, stale } = useServiceStatus()
  const {
    systemInfo,
    loading: systemLoading,
    error: systemError,
  } = useSystemInfo()
  const bindings = useSampleSettingsState()
  return {
    statusLoading: loading || bindings.loading,
    statusUnavailable: connectionError && !stale,
    statusStale: stale,
    bindingsUnavailable: bindings.unavailable,
    bindingsStale: bindings.stale,
    systemInfo,
    systemLoading,
    systemUnavailable: systemError && !systemLoading,
  }
}
