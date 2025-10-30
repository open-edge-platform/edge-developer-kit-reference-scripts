// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload'
import { addon as ov } from 'openvino-node'
import { createResponse } from '@/utils/common'

const getAvailableDevices = async () => {
  try {
    const core = new ov.Core()
    const devices = core.getAvailableDevices()
    let availableDevices = []
    availableDevices = devices.map((device) => {
      try {
        const fullName = core.getProperty(device, 'FULL_DEVICE_NAME')
        return { id: device, name: fullName.toString() }
      } catch (err) {
        console.error(`Error fetching device property for ${device}:`, err)
        return { id: device, name: device }
      }
    })
    return availableDevices
  } catch (error) {
    let errorMessage = 'Failed to retrieve available devices'
    if (error instanceof Error) {
      errorMessage = error.message
    }
    console.error(errorMessage, error)
    return []
  }
}

export const Devices: CollectionConfig = {
  slug: 'devices',
  fields: [],
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  endpoints: [
    {
      path: '/available-devices',
      method: 'get',
      handler: async () => {
        const availableDevices = await getAvailableDevices()
        return createResponse<{ id: string; name: string }[]>(
          true,
          'Available devices retrieved successfully',
          availableDevices,
        )
      },
    },
  ],
}
