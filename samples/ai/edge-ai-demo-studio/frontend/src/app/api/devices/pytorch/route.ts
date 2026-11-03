// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import { jsonErrorFrom } from '@/lib/api/json'
import { queryScriptDevices } from '@/lib/system/devices'

/** `{ devices }` PyTorch can run on. */
export async function GET() {
  try {
    return NextResponse.json({ devices: await queryScriptDevices('pytorch') })
  } catch (error) {
    return jsonErrorFrom(error, 'Failed to query PyTorch devices')
  }
}
