// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Device } from '@/types/common'
import { ALL_DEVICE_TYPES } from './constants'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Get the OS display label */
export { getOSLabel } from '@/types/common'

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

// Extracts the first meaningful sentence from a description, stripping Args/parameter blocks
export function getFirstSentence(text: string): string {
  const beforeArgs = text.split(/\n\n/)[0].trim()
  const sentenceMatch = beforeArgs.match(/^(.+?[.!?])(?:\s|$)/)
  return sentenceMatch ? sentenceMatch[1] : beforeArgs
}
