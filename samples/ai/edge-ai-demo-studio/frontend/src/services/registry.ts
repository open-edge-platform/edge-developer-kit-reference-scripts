// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { HostOS } from '@/types/common'
import { serviceMap } from './_generated/services'
import type { Service } from './types'

export const services: Service[] = Object.values(serviceMap)

export const visibleServices: Service[] = services.filter((s) => !s.hidden)

export function getServiceById(id: string): Service | undefined {
  if (!(id in serviceMap)) return undefined
  return serviceMap[id as keyof typeof serviceMap]
}

export function isServiceSupportedOnOS(service: Service, os: HostOS): boolean {
  return service.supportedOS.some((supported) => supported === os)
}
