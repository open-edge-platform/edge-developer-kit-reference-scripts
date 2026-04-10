// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Device } from '@/types/common'
import { ALL_DEVICE_TYPES } from './constants'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getDeviceFamily(deviceId: string): Device {
  const base = deviceId.split(/[.:]/)[0].toLowerCase()
  if (ALL_DEVICE_TYPES.includes(base as Device)) {
    return base as Device
  }
  return 'cpu'
}

export function isDeviceInFamilies(
  deviceId: string,
  families: Device[],
): boolean {
  return families.includes(getDeviceFamily(deviceId))
}

/**
 * Extract the first meaningful sentence from a tool description,
 * stripping Args/parameter documentation that follows double newlines.
 */
export function getFirstSentence(text: string): string {
  // Cut at the first double-newline (often precedes "Args:" blocks)
  const beforeArgs = text.split(/\n\n/)[0].trim()
  // If still long, take the first sentence (ends with . or : followed by space/end)
  const sentenceMatch = beforeArgs.match(/^(.+?[.!?])(?:\s|$)/)
  return sentenceMatch ? sentenceMatch[1] : beforeArgs
}
