// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { clsx, type ClassValue } from 'clsx'
import { randomBytes } from 'crypto'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Generate a cryptographically secure random number in the range [0, 1)
 */
export function secureRandom(): number {
  const bytes = randomBytes(4)
  const value = bytes.readUInt32BE(0)
  return value / 0x100000000
}
