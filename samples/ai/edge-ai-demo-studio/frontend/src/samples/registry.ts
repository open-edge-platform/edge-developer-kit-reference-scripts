// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export { categories, getCategoryLabels, hasCategory } from './types'

import { getServiceById } from '@/services/registry'
import type { Service } from '@/services/types'
import type { HostOS, OS } from '@/types/common'
import { getDeviceFamily } from '@/lib/devices'
import { sampleMap } from './_generated/samples'
import type { Sample } from './types'
import { getRequiredDeps } from './types'

export const samples: Sample[] = Object.values(sampleMap)

export function getSampleById(id: string): Sample | undefined {
  return sampleMap[id]
}

function getRequiredServicesForSample(sample: Sample): Service[] {
  return getRequiredDeps(sample).flatMap((d) => {
    const service = getServiceById(d.serviceId)
    return service ? [service] : []
  })
}

export function getSampleSupportedOS(sample: Sample): OS[] {
  if (sample.supportedOS && sample.supportedOS.length > 0) {
    return sample.supportedOS
  }
  const requiredServices = getRequiredServicesForSample(sample)
  if (requiredServices.length === 0) return ['linux', 'windows']
  return requiredServices[0].supportedOS.filter((os) =>
    requiredServices.every((s) => s.supportedOS.includes(os)),
  )
}

/** Whether the sample runs on `os` — never on a host OS no service supports (macOS). */
export function isSampleSupportedOnOS(sample: Sample, os: HostOS): boolean {
  return getSampleSupportedOS(sample).some((supported) => supported === os)
}

function isDeviceAvailable(
  required: string,
  availableDevices: string[],
): boolean {
  const isFamily = !required.includes('.') && !required.includes(':')
  if (isFamily) {
    const reqFamily = required.toLowerCase()
    return availableDevices.some((d) => {
      const family = getDeviceFamily(d)
      if (reqFamily === 'gpu' || reqFamily === 'xpu') {
        return family === 'gpu' || family === 'xpu'
      }
      return family === reqFamily
    })
  }
  const reqLower = required.toLowerCase()
  return availableDevices.some((d) => d.toLowerCase() === reqLower)
}

export function getMissingSampleDevices(
  sample: Sample,
  availableDevices: string[],
): string[] {
  if (!sample.requiredDevices || sample.requiredDevices.length === 0) return []
  return sample.requiredDevices.filter(
    (d) => !isDeviceAvailable(d, availableDevices),
  )
}
