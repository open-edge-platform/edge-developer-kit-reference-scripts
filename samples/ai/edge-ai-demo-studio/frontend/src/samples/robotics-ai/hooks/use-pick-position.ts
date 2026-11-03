// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { requireApiBase } from '@/lib/browser/api-base'
import {
  confirmArmCalibration,
  fetchGripperConfig,
  ROBOTICS_SERVICE,
  roboticsKey,
  saveGripperConfig,
  startArmCalibration,
} from '../lib/api'

/** Gripper positions until the worker's saved ones are in. */
const DEFAULT_GRIPPER = { open: 60, close: 40 }

/** The gripper's open/close positions: the worker's saved ones, overridden by unsaved edits. */
export function useGripperConfig(workerBaseUrl: string | undefined) {
  const saved = useQuery({
    queryKey: roboticsKey('gripper-config', workerBaseUrl),
    queryFn: () => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return fetchGripperConfig(workerBaseUrl)
    },
    enabled: workerBaseUrl !== undefined,
    retry: false,
    staleTime: 0,
  })
  const [openOverride, setOpen] = useState<number | undefined>(undefined)
  const [closeOverride, setClose] = useState<number | undefined>(undefined)
  const open = openOverride ?? saved.data?.gripper_open ?? DEFAULT_GRIPPER.open
  const close =
    closeOverride ?? saved.data?.gripper_close ?? DEFAULT_GRIPPER.close

  const save = useMutation({
    mutationFn: () => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return saveGripperConfig(workerBaseUrl, {
        gripper_open: open,
        gripper_close: close,
      })
    },
  })

  return {
    open,
    close,
    setOpen,
    setClose,
    isSaving: save.isPending,
    message: save.data?.message ?? null,
    error: save.error?.message ?? null,
    save: () => save.mutate(),
  }
}

/** Moving the arm to its pick position: the worker moves it, then waits for the user to confirm. */
export function useArmCalibration(workerBaseUrl: string | undefined) {
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)
  const step = useMutation({
    mutationFn: (action: 'start' | 'confirm') => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return action === 'start'
        ? startArmCalibration(workerBaseUrl)
        : confirmArmCalibration(workerBaseUrl)
    },
    onSuccess: (_, action) => setAwaitingConfirmation(action === 'start'),
    // A failed confirm leaves nothing to confirm: start again.
    onError: (_, action) => {
      if (action === 'confirm') setAwaitingConfirmation(false)
    },
  })
  const pending = step.isPending ? step.variables : undefined

  return {
    awaitingConfirmation,
    isStarting: pending === 'start',
    isConfirming: pending === 'confirm',
    message: step.data?.message ?? null,
    error: step.error?.message ?? null,
    start: () => step.mutate('start'),
    confirm: () => step.mutate('confirm'),
  }
}
