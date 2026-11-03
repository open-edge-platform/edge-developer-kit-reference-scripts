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
  | 'Suite'

export type DependencyRole = 'required' | 'optional'

/** Recommended device / model settings that can be applied in one click. */
export interface RecommendedServiceConfig {
  /** Recommended device string (e.g. 'GPU.0', 'CPU'). */
  device?: string
  model?: string
  /** Pin a quantization format (e.g. 'int8', 'int4'). */
  quant?: string
  /** Pin an inference backend (e.g. 'openvino', 'llamacpp'). */
  backend?: string
  /** The pinned model's type when not plain text: `multimodal` marks a vision model. */
  modelType?: string
}

export interface ServiceDependency {
  serviceId: PayloadService['type']
  role: DependencyRole
  capabilityKey?: string
  impactText?: string
  recommended?: RecommendedServiceConfig
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
  category: string[]
  dependencies: ServiceDependency[]
  tags: string[]
  image?: string | StaticImageData
  demo: SampleDemo
  supportedOS?: OS[]
  requiredDevices?: string[]
  pipeline?: PipelineStep[]
  docs?: {
    markdown?: string
    filePath?: string
  }
}

export function getRequiredDeps(s: Sample): ServiceDependency[] {
  return s.dependencies.filter((d) => d.role === 'required')
}

export function getOptionalDeps(s: Sample): ServiceDependency[] {
  return s.dependencies.filter((d) => d.role === 'optional')
}

function resolveDevice(
  requested: string,
  availableDevices?: string[],
): { device: string; fellBack: boolean; note?: string } {
  if (!availableDevices || availableDevices.length === 0) {
    return { device: requested, fellBack: false }
  }

  const reqLower = requested.toLowerCase()
  const reqFamily = reqLower.split(/[.:]/)[0]

  const exactMatch = availableDevices.find((d) => d.toLowerCase() === reqLower)
  if (exactMatch) return { device: exactMatch, fellBack: false }

  // Same family (GPU.1 → GPU.0); GPU and XPU are interchangeable.
  const familyMatch = availableDevices.find((d) => {
    const family = d.split(/[.:]/)[0].toLowerCase()
    if (reqFamily === 'gpu' || reqFamily === 'xpu') {
      return family === 'gpu' || family === 'xpu'
    }
    return family === reqFamily
  })
  if (familyMatch) {
    return {
      device: familyMatch,
      fellBack: true,
      note: `${requested} not available — using ${familyMatch}`,
    }
  }

  const cpu = availableDevices.find(
    (d) => d.split(/[.:]/)[0].toLowerCase() === 'cpu',
  )
  if (cpu) {
    return {
      device: cpu,
      fellBack: true,
      note: `${requested} not available — falling back to ${cpu}`,
    }
  }

  const first = availableDevices[0]
  if (first) {
    return {
      device: first,
      fellBack: true,
      note: `${requested} not available — using ${first}`,
    }
  }

  return { device: requested, fellBack: false }
}

// Recommended config helpers

export interface ResolvedRecommendation {
  serviceId: PayloadService['type']
  /** Resolved device after applying availability fallback; undefined when no device was specified. */
  device?: string
  model?: string
  quant?: string
  backend?: string
  modelType?: string
  /** True when the preferred device was unavailable and a fallback was used. */
  fellBack: boolean
  /** Human-readable explanation of the fallback (e.g. "GPU.1 not available — using GPU.0"). */
  fallbackNote?: string
}

export function hasRecommendedConfig(s: Sample): boolean {
  return s.dependencies.some((d) => d.recommended !== undefined)
}

/** Each dependency's recommended config, with device fallback against `availableDevices`. */
export function resolveRecommendedConfigs(
  s: Sample,
  availableDevices?: string[],
): ResolvedRecommendation[] {
  return s.dependencies.flatMap(({ serviceId, recommended: rec }) => {
    if (!rec) return []
    const resolved = rec.device
      ? resolveDevice(rec.device, availableDevices)
      : undefined
    return [
      {
        serviceId,
        device: resolved?.device,
        model: rec.model,
        quant: rec.quant,
        backend: rec.backend,
        modelType: rec.modelType,
        fellBack: resolved?.fellBack ?? false,
        fallbackNote: resolved?.note,
      },
    ]
  })
}

export function getCategoryLabels(s: Sample): string[] {
  return Array.from(
    new Set(s.category.map((label) => label.trim()).filter(Boolean)),
  )
}

export function hasCategory(s: Sample, category: string): boolean {
  return getCategoryLabels(s).includes(category)
}

/** Coarse verdict the gallery filters and sorts on; the full model is `samples/common/readiness.ts`. */
export type ReadinessStatus = 'ready' | 'partial' | 'blocked'

export const categories: SampleCategory[] = [
  'Conversational AI',
  'Vision',
  'Productivity',
  'Creative',
  'Suite',
  'Education',
]
