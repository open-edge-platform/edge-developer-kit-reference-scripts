// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { ReactNode } from 'react'
import { ConfigSection } from '@/components/configure/config-section'
import { DeviceSelect } from '@/components/configure/device-select'
import type { WorkerDevices } from './use-worker-device'

/** The Accelerator section of a worker panel: the drafted model's devices. */
export function AcceleratorSection({
  id,
  devices,
  onDeviceChange,
  note,
}: {
  /** DOM id of the device select. */
  id: string
  devices: WorkerDevices
  onDeviceChange: (device: string) => void
  /** Under the device select, for the drafted model and device. */
  note?: ReactNode
}) {
  return (
    <ConfigSection title="Accelerator">
      <DeviceSelect
        id={id}
        value={devices.device}
        onValueChange={onDeviceChange}
        options={devices.options}
        isLoading={devices.isLoading}
        isError={devices.isError}
        onRetry={devices.retry}
      />
      {note}
    </ConfigSection>
  )
}
