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
  getOptionalDeps,
  getReadinessLabel,
  getRequiredDeps,
} from './types'

import { getServiceById } from '@/services/registry'
import type { Service } from '@/services/types'
import type { OS } from '@/types/common'
import { sampleMap } from './_generated/samples'
import type { Sample } from './types'
import { getOptionalDeps, getRequiredDeps } from './types'

// ─── Aggregated Exports ───────────────────────────────────────────
export { sampleMap } from './_generated/samples'

export const samples: Sample[] = Object.values(sampleMap)

export function getSampleById(id: string): Sample | undefined {
  return sampleMap[id]
}

/** Resolve required dependency service objects */
export function getRequiredServicesForSample(sample: Sample): Service[] {
  return getRequiredDeps(sample)
    .map((d) => getServiceById(d.serviceId))
    .filter(Boolean) as Service[]
}

/** Resolve optional dependency service objects */
export function getOptionalServicesForSample(sample: Sample): Service[] {
  return getOptionalDeps(sample)
    .map((d) => getServiceById(d.serviceId))
    .filter(Boolean) as Service[]
}

// ─── OS compatibility helpers ──────────────────────────────────────

/**
 * Get the effective supported OS list for a sample.
 * If the sample has explicit `supportedOS`, use that.
 * Otherwise, compute the intersection of all required services' supported OS.
 */
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

/** Check if a sample is supported on the given OS */
export function isSampleSupportedOnOS(sample: Sample, os: OS): boolean {
  return getSampleSupportedOS(sample).includes(os)
}
