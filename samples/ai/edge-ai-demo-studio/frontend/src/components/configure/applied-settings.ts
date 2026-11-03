// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { AppliedDifference } from '@/lib/instances/runtime-fields'
import { isRunningStatus } from '@/lib/instances/service-status'
import { getExecutionModeOptions } from '@/services/execution'
import type { Service } from '@/types/service'

/** How a panel labels its own setting in running-vs-saved rows; keyed like `AppliedDifference.key`. */
export interface SettingDescription {
  label: string
  /** The value as the panel shows it; the raw value otherwise. */
  format?: (value: string) => string
  /** What an unset value means (e.g. the default it runs with). */
  unset?: string
}

export type SettingDescriptions = Record<string, SettingDescription>

/** Names of the settings every panel shares, and of documented metadata. */
const SETTING_LABELS: Record<string, string> = {
  model: 'Model',
  device: 'Device',
  backend: 'Backend',
  quant: 'Quantization',
  source: 'Model source',
  params: 'Serving options',
  modelType: 'Model type',
  engine: 'Engine',
  'metadata.cpuAffinity': 'CPU affinity',
  'metadata.languageCode': 'Language',
  'metadata.vadThreshold': 'VAD threshold',
  'metadata.serverIceServerUrl': 'Server ICE server',
  'metadata.audioDevice': 'Microphone',
  'metadata.vectorDbBackend': 'Vector store',
  'metadata.pgConnectionString': 'PostgreSQL URL',
  'metadata.serverArgs': 'Server arguments',
  'metadata.denoiseDevice': 'Noise suppression device',
  'metadata.embeddingBatchSize': 'Batch size',
  'metadata.performanceMode': 'Performance hint',
  'metadata.compiledModelCache': 'Compiled model cache',
}

/** `someMetadataKey` → "Some metadata key", for keys nobody named. */
function humanize(key: string): string {
  const words = key
    .replace(/^metadata\./, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** One running-versus-saved row, ready to show. */
export interface DescribedDifference {
  key: string
  label: string
  running: string
  saved: string
}

/**
 * Saved settings a running instance does not use yet (what "Restart to apply" applies). Empty when
 * nothing runs or the server does not know what it was started with.
 */
function unappliedSettings(
  service: Pick<Service, 'status' | 'applied'>,
): AppliedDifference[] {
  if (!isRunningStatus(service.status)) return []
  return service.applied?.unapplied ?? []
}

/** Each unapplied setting with its name and both values in words. */
export function describeUnappliedSettings(
  service: Pick<Service, 'status' | 'applied' | 'execution'>,
  descriptions: SettingDescriptions = {},
): DescribedDifference[] {
  const engines = getExecutionModeOptions(service.execution)
  const word = (key: string, value: string | null): string => {
    if (value === null) {
      if (descriptions[key]?.unset) return descriptions[key].unset
      return key === 'metadata.cpuAffinity' ? 'All cores' : 'Not set'
    }
    const format = descriptions[key]?.format
    if (format) return format(value)
    if (key === 'engine') {
      return engines.find((e) => e.mode === value)?.label ?? value
    }
    return value
  }
  return unappliedSettings(service).map(({ key, running, saved }) => ({
    key,
    label: descriptions[key]?.label ?? SETTING_LABELS[key] ?? humanize(key),
    running: word(key, running),
    saved: word(key, saved),
  }))
}
