// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Readers of a service's model configuration (devices, backend, precision, custom ids), shared by
 * client and server. The model a row runs is `getEffectiveModel` in `@/types/service`.
 */

import type { DeviceBackend, ModelWeight, ServiceConfig } from './types'

/**
 * Whether a device option names the device a backend reports, handling
 * backend-specific naming (`GPU.0` ≈ `gpu`, and `gpu` ≈ `xpu` on PyTorch).
 */
export function isDeviceMatch(
  optionValue: string,
  backendDeviceValue: string,
  backend?: DeviceBackend,
): boolean {
  const strip = (v: string) => v.replace(/[.:]\d+$/i, '').toLowerCase()
  const a = strip(optionValue)
  const b = strip(backendDeviceValue)
  if (a === b) return true
  if (backend === 'pytorch') {
    if ((a === 'gpu' && b === 'xpu') || (a === 'xpu' && b === 'gpu'))
      return true
  }
  return false
}

/** The devices a model runs on: its own list, else the service's. */
export function getDevicesForModel(
  config: ServiceConfig | undefined,
  modelValue: string,
): string[] {
  const model = config?.availableModels?.find((m) => m.value === modelValue)
  if (model?.availableDevices?.length) return model.availableDevices
  return config?.availableDevices ?? []
}

/** Whether the service offers a Precision choice: it lists weight formats and a default one. */
export function offersPrecision(config: ServiceConfig | undefined): boolean {
  return Boolean(
    config?.availableWeightFormats?.length && config.defaultWeightFormat,
  )
}

/** The precisions a model runs at: its own list (one format when fixed), else the service's. */
export function getWeightFormatsForModel(
  config: ServiceConfig | undefined,
  modelValue: string,
): string[] {
  const model = config?.availableModels?.find((m) => m.value === modelValue)
  return model?.availableWeightFormats ?? config?.availableWeightFormats ?? []
}

/** The precision `modelValue` runs at: its fixed one, else the instance's (`getEffectivePrecision`). */
export function getModelPrecision(
  config: ServiceConfig | undefined,
  modelValue: string,
  quant: string | null | undefined,
): string | undefined {
  const formats = getWeightFormatsForModel(config, modelValue)
  if (formats.length === 1) return formats[0]
  return formats.length > 0 ? getEffectivePrecision(config, quant) : undefined
}

/**
 * The precision an instance converts at: its saved `quant` when the service offers it, else the
 * service's default (also for a `quant` meant for another backend or engine).
 */
export function getEffectivePrecision(
  config: ServiceConfig | undefined,
  quant: string | null | undefined,
): string | undefined {
  const saved = quant?.trim().toLowerCase()
  return saved && config?.availableWeightFormats?.includes(saved)
    ? saved
    : config?.defaultWeightFormat
}

/**
 * Whether the service accepts ids beyond `availableModels` (`supportsCustomModel` or a `custom`
 * source). The one reading of the flag, so Configure and `deployment.json` validation agree.
 */
export function supportsCustomModels(
  config: ServiceConfig | undefined,
): boolean {
  if (!config) return false
  return (
    Boolean(config.supportsCustomModel) ||
    (config.availableModelSources ?? []).some((s) => s.value === 'custom')
  )
}

export function getBackendForModel(
  config: ServiceConfig | undefined,
  modelValue: string,
): DeviceBackend | undefined {
  const model = config?.availableModels?.find((m) => m.value === modelValue)
  return model?.backend
}

export function getWeightForModel(
  config: ServiceConfig | undefined,
  modelValue: string,
): ModelWeight | undefined {
  const model = config?.availableModels?.find(
    (m) => m.value.toLowerCase() === modelValue.toLowerCase(),
  )
  return model?.weight
}
