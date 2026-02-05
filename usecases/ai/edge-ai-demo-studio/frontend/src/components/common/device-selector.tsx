// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useOpenVINOAccelerator,
  usePytorchAccelerator,
  useVulkanAccelerator,
} from '@/hooks/use-accelerators'

import { Accelerator } from '@/types/accelerator'

interface DeviceSelectorProps {
  value: string
  onChange: (value: string) => void
  label?: React.ReactNode
  className?: string
  accelerator?: 'openvino' | 'pytorch' | 'vulkan'
  devices?: Accelerator[]
}

export function DeviceSelector({
  value,
  onChange,
  label = 'Device',
  className,
  accelerator = 'openvino',
  devices: providedDevices,
}: DeviceSelectorProps) {
  const { data: ovDevices } = useOpenVINOAccelerator()
  const { data: ptDevices } = usePytorchAccelerator()
  const { data: vulkanDevices } = useVulkanAccelerator()

  const devices = providedDevices
    ? providedDevices
    : accelerator === 'openvino'
      ? ovDevices
      : accelerator === 'vulkan'
        ? vulkanDevices
        : ptDevices

  return (
    <div className={className}>
      <Label htmlFor="device-select" className="text-base font-medium">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-2 w-full">
          <SelectValue placeholder="Choose a device" />
        </SelectTrigger>
        <SelectContent>
          {(devices ?? []).map((device) => (
            <SelectItem key={device.id} value={device.id}>
              <div className="flex flex-col">
                <span className="font-medium">{device.name}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
