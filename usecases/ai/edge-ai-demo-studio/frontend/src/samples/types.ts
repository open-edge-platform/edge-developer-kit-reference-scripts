// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ComponentType } from 'react'
import type { Service as PayloadService } from '@/payload-types'
import type { OS } from '@/types/common'
import type { StaticImageData } from 'next/image'

export type SampleCategory =
  | 'Conversational AI'
  | 'Vision'
  | 'Productivity'
  | 'Creative'
  | 'Education'

export type DependencyRole = 'required' | 'optional'

export interface ServiceDependency {
  serviceId: PayloadService['type']
  role: DependencyRole
  defaultDevice?: string
  capabilityKey?: string
  impactText?: string
}

export type SampleDemoType = 'component' | 'external'

export interface SampleDemo {
  type: SampleDemoType
  component?: ComponentType<{ sample: Sample }>
  externalUrl?: string
  externalLabel?: string
  externalDescription?: string
}

export type PipelineStep = PayloadService['type'] | PayloadService['type'][]

export interface Sample {
  id: string
  title: string
  description: string
  longDescription: string
  category: SampleCategory
  dependencies: ServiceDependency[]
  tags: string[]
  image?: string | StaticImageData
  demo: SampleDemo
  supportedOS?: OS[]
  requiredDevices?: string[]
  pipeline?: PipelineStep[]
}

export function getRequiredDeps(s: Sample): ServiceDependency[] {
  return s.dependencies.filter((d) => d.role === 'required')
}

export function getOptionalDeps(s: Sample): ServiceDependency[] {
  return s.dependencies.filter((d) => d.role === 'optional')
}

export function getDeviceMap(
  s: Sample,
  availableDevices?: string[],
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const d of s.dependencies) {
    if (d.defaultDevice) {
      map[d.serviceId] = resolveDevice(d.defaultDevice, availableDevices)
    }
  }
  return map
}

function resolveDevice(requested: string, availableDevices?: string[]): string {
  if (!availableDevices || availableDevices.length === 0) return requested

  const reqLower = requested.toLowerCase()

  const found = availableDevices.some((d) => {
    const family = d.split(/[.:]/)[0].toLowerCase()
    return d.toLowerCase() === reqLower || family === reqLower
  })

  if (found) return requested

  const cpu = availableDevices.find(
    (d) => d.split(/[.:]/)[0].toLowerCase() === 'cpu',
  )
  return cpu ?? availableDevices[0] ?? requested
}

export type ReadinessStatus = 'ready' | 'partial' | 'blocked'

export function getReadinessLabel(status: ReadinessStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready to launch'
    case 'partial':
      return 'Ready (limited)'
    case 'blocked':
      return 'Setup required'
  }
}

export const categories: SampleCategory[] = [
  'Conversational AI',
  'Vision',
  'Productivity',
  'Creative',
  'Education',
]
