// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import { addon as ov } from 'openvino-node'

export async function GET() {
  try {
    const core = new ov.Core()
    const devices = core.getAvailableDevices()
    const deviceDetails = devices.map((device) => {
      try {
        const fullName = core.getProperty(device, 'FULL_DEVICE_NAME')
        return {
          id: device,
          name: `${fullName}${device === 'CPU' ? ' (CPU)' : ''}`,
        }
      } catch (err) {
        console.error(`Error fetching device property for ${device}:`, err)
        return { id: device, name: device }
      }
    })
    return NextResponse.json({ devices: deviceDetails })
  } catch (error) {
    let errorMessage = 'Failed to do something exceptional'
    if (error instanceof Error) {
      errorMessage = error.message
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
