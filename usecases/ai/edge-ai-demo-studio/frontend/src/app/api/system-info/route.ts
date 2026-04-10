// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import os from 'node:os'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function detectOS(): 'linux' | 'windows' | 'macos' {
  const platform = os.platform()
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  return 'linux'
}

export async function GET() {
  return NextResponse.json({
    os: detectOS(),
  })
}
