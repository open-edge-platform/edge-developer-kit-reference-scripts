// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import os from 'os'

const NOT_AVAILABLE = 'Not Available'

function calculatePercentage(num: number, total: number): number {
  if (total === 0) return 0
  return (num / total) * 100
}

function bytesToGigabytes(bytes: number): number {
  return bytes / 1024 ** 3
}

export async function GET() {
  const totalMemory = Number.isFinite(os.totalmem())
    ? os.totalmem()
    : NOT_AVAILABLE
  const freeMemory = Number.isFinite(os.freemem())
    ? os.freemem()
    : NOT_AVAILABLE

  if (totalMemory === NOT_AVAILABLE || freeMemory === NOT_AVAILABLE) {
    return NextResponse.json({
      free: NOT_AVAILABLE,
      used: NOT_AVAILABLE,
      total: NOT_AVAILABLE,
      freePercentage: NOT_AVAILABLE,
      usedPercentage: NOT_AVAILABLE,
    })
  }
  const usedMemory = totalMemory - freeMemory
  const freeMemoryInGigabyte = bytesToGigabytes(freeMemory)
  const usedMemoryInGigabyte = bytesToGigabytes(usedMemory)
  const totalMemoryInGigabyte = bytesToGigabytes(totalMemory)

  const usedMemoryPercentage = calculatePercentage(usedMemory, totalMemory)
  const freeMemoryPercentage = calculatePercentage(freeMemory, totalMemory)

  return NextResponse.json({
    free: freeMemoryInGigabyte,
    used: usedMemoryInGigabyte,
    total: totalMemoryInGigabyte,
    freePercentage: freeMemoryPercentage,
    usedPercentage: usedMemoryPercentage,
  })
}
