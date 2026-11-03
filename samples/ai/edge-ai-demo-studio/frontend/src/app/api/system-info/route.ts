// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import { readSystemInfo } from '@/lib/system/system-info'

export const dynamic = 'force-dynamic'

/** `SystemInfoResponse`: OS, accelerator families, CPU cores. */
export async function GET() {
  return NextResponse.json(await readSystemInfo())
}
