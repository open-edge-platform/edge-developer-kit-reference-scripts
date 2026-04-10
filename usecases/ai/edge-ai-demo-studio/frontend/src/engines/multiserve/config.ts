// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Service } from '@/payload-types'
import type { SelectOption, ServiceConfig } from '@/services/types'
import type { OS } from '@/types/common'
import { supportedBackends } from './backends'

// ─── Constants ────────────────────────────────────────────────────

/**
 * Known weight formats for OpenVINO model conversion.
 * Used to validate user-supplied weight formats for non-OpenVINO models.
 */
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

/** Pipeline types for OpenVINO Model Server text-generation. */
export const OVMS_PIPELINE_TYPES: SelectOption[] = [
  { value: 'AUTO', label: 'AUTO (Automatic Detection)' },
  { value: 'LLM', label: 'LLM' },
  { value: 'LLM_CB', label: 'LLM (Continuous Batching)' },
  { value: 'VLM', label: 'VLM' },
  { value: 'VLM_CB', label: 'VLM (Continuous Batching)' },
]

/** Platforms where a model can be fetched from. */
export const MODEL_SOURCES: SelectOption[] = [
  { value: 'huggingface', label: 'Hugging Face' },
  { value: 'modelscope', label: 'ModelScope' },
  { value: 'custom', label: 'Custom (Local Upload)' },
]

/** Model type / usage options (standard vs. vision-language). */
export const MODEL_TYPES: SelectOption[] = [
  { value: 'default', label: 'Default (Text Generation)' },
  { value: 'multimodal', label: 'Multimodal (VLM)' },
]

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Derive a human-readable label from a model's backend metadata.
 */
function deriveModelLabel(
  model: Service['models']['default'],
  backendName: string,
): string {
  const shortName = model.name.includes('/')
    ? (model.name.split('/').pop() as string)
    : model.name

  // Strip common repo suffixes (-ov, -GGUF) and replace dashes with spaces
  const cleaned = shortName.replace(/-ov$/, '').replace(/-GGUF$/, '')

  const parts = [cleaned]
  if (model.quant) parts.push(model.quant)
  if (model.type === 'multimodal') parts.push('— multimodal')
  parts.push(`(${backendName})`)

  return parts.join(' ')
}

// ─── Config Builders ──────────────────────────────────────────────

/**
 * Build a ServiceConfig for a given service type by aggregating
 * models, devices, and backend-specific options from all multiserve backends.
 */
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

/**
 * Get the default model for a given service type.
 * When `os` is provided, prefers the backend whose `recommendedOS` matches,
 * falling back to the first compatible backend.
 */
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
