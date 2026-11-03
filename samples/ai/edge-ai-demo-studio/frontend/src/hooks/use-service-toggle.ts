// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  useServiceActivity,
  useServiceStatus,
} from '@/context/service-status-context'
import type { ServiceAction } from '@/hooks/use-services'
import { isRunningStatus, type ServiceStatus } from '@/services/types'

export interface UseServiceToggleResult {
  status: ServiceStatus
  pending: boolean
  /** The request in flight — which may differ from `action` (e.g. a stop sent while starting). */
  pendingAction: ServiceAction | null
  /** Action the button would perform — `null` while a request is in flight. */
  action: ServiceAction | null
  run: () => void
}

/** online/starting -> stop, error -> restart, offline -> start. */
export function actionFor(status: ServiceStatus): ServiceAction {
  if (isRunningStatus(status)) return 'stop'
  if (status === 'error') return 'restart'
  return 'start'
}

/** Start/stop/restart toggle for one service or instance. */
export function useServiceToggle(serviceKey: string): UseServiceToggleResult {
  const { serviceById, startService, stopService, restartService } =
    useServiceStatus()
  const { getPendingAction } = useServiceActivity()

  const status = serviceById.get(serviceKey)?.status ?? 'offline'
  const pendingAction = getPendingAction(serviceKey)
  const pending = pendingAction !== null
  const action = actionFor(status)

  const run = () => {
    if (pending) return
    const request =
      action === 'stop'
        ? stopService(serviceKey)
        : action === 'restart'
          ? restartService(serviceKey)
          : startService(serviceKey)
    // A failure is already reported as a toast.
    request.catch(() => {})
  }

  return {
    status,
    pending,
    pendingAction,
    action: pending ? null : action,
    run,
  }
}
