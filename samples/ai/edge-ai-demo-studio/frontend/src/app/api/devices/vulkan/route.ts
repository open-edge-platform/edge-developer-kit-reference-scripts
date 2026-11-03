// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import { jsonErrorFrom } from '@/lib/api/json'
import { queryLlamaDevices } from '@/lib/system/devices'

/** `{ build, devices }`: the devices llama.cpp's Vulkan or SYCL build can run on. */
export async function GET() {
  try {
    return NextResponse.json(await queryLlamaDevices())
  } catch (error) {
    return jsonErrorFrom(error, 'Failed to query GPU devices')
  }
}
