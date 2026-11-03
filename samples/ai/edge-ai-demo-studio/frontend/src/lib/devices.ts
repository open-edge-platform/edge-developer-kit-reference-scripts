// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Device } from '@/types/common'

const ALL_DEVICE_TYPES: readonly Device[] = ['cpu', 'gpu', 'xpu', 'npu']

/** The family of a device id (`GPU.1` → `gpu`); anything unknown is `cpu`. */
export function getDeviceFamily(deviceId: string): Device {
  const base = deviceId.split(/[.:]/)[0].toLowerCase()
  return ALL_DEVICE_TYPES.find((type) => type === base) ?? 'cpu'
}
