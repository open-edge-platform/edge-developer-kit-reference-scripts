// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { isRunningStatus, type ServiceInstance } from '@/services/types'

/** Rows ticked for a bulk action in the Manage instances sheet, keyed by instance key. */
export function useInstanceSelection(instances: ServiceInstance[]) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())

  // A deleted row drops out of the selection by itself.
  const selected = instances.filter((i) => checked.has(i.instanceKey))
  const toStart = selected.filter((i) => !isRunningStatus(i.status))
  const toStop = selected.filter((i) => isRunningStatus(i.status))
  const allChecked =
    instances.length > 0 && selected.length === instances.length

  const toggle = (key: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const setAll = (on: boolean) =>
    setChecked(on ? new Set(instances.map((i) => i.instanceKey)) : new Set())

  return { checked, selected, toStart, toStop, allChecked, toggle, setAll }
}
