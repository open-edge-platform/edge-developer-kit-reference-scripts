// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Accelerator } from '@/types/accelerator'
import { useQuery } from '@tanstack/react-query'

export const useOpenVINOAccelerator = () => {
  return useQuery({
    queryKey: ['accelerators', 'openvino'],
    queryFn: async () => {
      const response = await fetch('/api/accelerators/openvino')
      if (!response.ok) {
        throw new Error('Failed to fetch accelerators')
      }
      const data = await response.json()
      return (data.devices ? data.devices : []) as Accelerator[]
    },
  })
}

export const usePytorchAccelerator = () => {
  return useQuery({
    queryKey: ['accelerators', 'pytorch'],
    queryFn: async () => {
      const response = await fetch('/api/accelerators/pytorch')
      if (!response.ok) {
        throw new Error('Failed to fetch accelerators')
      }
      const data = await response.json()
      return (data.devices ? data.devices : []) as Accelerator[]
    },
  })
}

export const useVulkanAccelerator = () => {
  return useQuery({
    queryKey: ['accelerators', 'vulkan'],
    queryFn: async () => {
      const response = await fetch('/api/accelerators/vulkan')
      if (!response.ok) {
        throw new Error('Failed to fetch accelerators')
      }
      const data = await response.json()
      return (data.devices ? data.devices : []) as Accelerator[]
    },
  })
}
