// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Service } from '@/payload-types'
import type { OS, SelectOption, ServiceConfig } from '@/types/common'
import { supportedBackends } from './backends'

export const KNOWN_QUANTIZATIONS = [
  'int4',
  'int8',
  'fp16',
  'fp32',
  'nf4',
  'int4_sym_g128',
  'int4_asym_g128',
  'int4_sym_g64',
  'int4_asym_g64',
  'int8_sym',
  'int8_asym',
] as const

export const OVMS_PIPELINE_TYPES: SelectOption[] = [
  { value: 'AUTO', label: 'AUTO (Automatic Detection)' },
  { value: 'LLM', label: 'LLM' },
  { value: 'LLM_CB', label: 'LLM (Continuous Batching)' },
  { value: 'VLM', label: 'VLM' },
  { value: 'VLM_CB', label: 'VLM (Continuous Batching)' },
]

const MODEL_SOURCES: SelectOption[] = [
  { value: 'huggingface', label: 'Hugging Face' },
  { value: 'modelscope', label: 'ModelScope' },
  { value: 'custom', label: 'Custom (Local Upload)' },
]

export const MODEL_TYPES: SelectOption[] = [
  { value: 'default', label: 'Default (Text Generation)' },
  { value: 'multimodal', label: 'Multimodal (VLM)' },
]

// ─── Helpers ──────────────────────────────────────────────────────

function deriveModelLabel(
  model: Service['models']['default'],
  backendName: string,
): string {
  const shortName = model.name.includes('/')
    ? (model.name.split('/').pop() as string)
    : model.name

  const cleaned = shortName.replace(/-ov$/, '').replace(/-GGUF$/, '')

  const parts = [cleaned]
  if (model.quant) parts.push(model.quant)
  if (model.type === 'multimodal') parts.push('— multimodal')
  parts.push(`(${backendName})`)

  return parts.join(' ')
}

// ─── Config Builders ──────────────────────────────────────────────

// Aggregates models, devices, and options from all multiserve backends for a service
export function getMultiserveServiceConfig(
  serviceType: Service['type'],
): ServiceConfig {
  const models: NonNullable<ServiceConfig['availableModels']> = []
  const deviceSet = new Set<string>()
  let includeOpenVINOOptions = false

  for (const backend of supportedBackends) {
    if (!backend.supportedServices.includes(serviceType)) continue

    const backendDevices = backend.supportedDevices.map((d) => d.toUpperCase())

    const backendModels = backend.models[serviceType] ?? []
    for (const m of backendModels) {
      models.push({
        value: m.name,
        label: deriveModelLabel(m, backend.name),
        availableDevices: backendDevices,
      })
    }

    for (const d of backend.supportedDevices) {
      deviceSet.add(d)
    }

    if (backend.value === 'openvino') {
      includeOpenVINOOptions = true
    }
  }

  return {
    availableModels: models,
    availableDevices: [...deviceSet].map((d) => d.toUpperCase()),
    availableModelSources: MODEL_SOURCES,
    availableModelTypes: MODEL_TYPES,
    ...(includeOpenVINOOptions && {
      availablePipelineTypes: OVMS_PIPELINE_TYPES,
      availableWeightFormats: [...KNOWN_QUANTIZATIONS],
    }),
  }
}

// Gets default model for a service type, preferring backend matching current OS
export function getMultiserveDefaultModel(
  serviceType: Service['type'],
  os?: OS,
) {
  const compatible = supportedBackends.filter(
    (b) =>
      b.supportedServices.includes(serviceType) &&
      (b.models[serviceType]?.length ?? 0) > 0,
  )
  if (compatible.length === 0) return undefined

  const preferred =
    os != null
      ? compatible.find(
          (b) => b.recommendedOS === os && b.supportedOS.includes(os),
        )
      : undefined
  const target = preferred ?? compatible[0]
  return target.models[serviceType]?.[0]
}
