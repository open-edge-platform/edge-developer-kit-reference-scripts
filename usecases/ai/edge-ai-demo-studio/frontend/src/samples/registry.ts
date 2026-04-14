// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type {
  DependencyRole,
  PipelineStep,
  ReadinessStatus,
  Sample,
  SampleCategory,
  SampleDemo,
  SampleDemoType,
  ServiceDependency,
} from './types'

export {
  categories,
  getDeviceMap,
  getOptionalDeps,
  getReadinessLabel,
  getRequiredDeps,
} from './types'

import { getServiceById } from '@/services/registry'
import type { Service } from '@/services/types'
import type { OS } from '@/types/common'
import { getDeviceFamily } from '@/lib/utils'
import { sampleMap } from './_generated/samples'
import type { Sample } from './types'
import { getOptionalDeps, getRequiredDeps } from './types'

export { sampleMap } from './_generated/samples'

export const samples: Sample[] = Object.values(sampleMap)

export function getSampleById(id: string): Sample | undefined {
  return sampleMap[id]
}

export function getRequiredServicesForSample(sample: Sample): Service[] {
  return getRequiredDeps(sample)
    .map((d) => getServiceById(d.serviceId))
    .filter(Boolean) as Service[]
}

export function getOptionalServicesForSample(sample: Sample): Service[] {
  return getOptionalDeps(sample)
    .map((d) => getServiceById(d.serviceId))
    .filter(Boolean) as Service[]
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

export function isSampleSupportedOnOS(sample: Sample, os: OS): boolean {
  return getSampleSupportedOS(sample).includes(os)
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

export function isSampleSupportedOnDevices(
  sample: Sample,
  availableDevices: string[],
): boolean {
  if (!sample.requiredDevices || sample.requiredDevices.length === 0)
    return true
  return sample.requiredDevices.every((d) =>
    isDeviceAvailable(d, availableDevices),
  )
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
