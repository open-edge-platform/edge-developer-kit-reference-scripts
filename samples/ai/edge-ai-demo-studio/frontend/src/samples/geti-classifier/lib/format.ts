// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { GetiModel } from './api'

/** A model as people name it: `name v3`, or just `name` without a version. */
export function formatModel(
  name: string,
  version: number | string | null | undefined,
): string {
  return version != null ? `${name} v${version}` : name
}

/** A model version offered in the wizard, unknown versions shown as `v?`. */
export function formatModelVersion(model: GetiModel): string {
  return formatModel(model.name, model.version ?? '?')
}

/** The wizard's chosen model: "Latest Active", `name v3`, or "—". */
export function formatModelChoice(
  selectedModelId: string,
  model: GetiModel | undefined,
): string {
  if (selectedModelId === 'latest') return 'Latest Active'
  return model ? formatModelVersion(model) : '—'
}

/** The server as the user knows it, without its scheme. */
export function hostLabel(host: string): string {
  return host.replace('https://', '').replace('http://', '')
}

const isGpu = (type: string) => /^GPU(\.\d+)?$/i.test(type)

/** What a device type is, for a device the worker names no better. */
export function deviceDescription(type: string): string {
  if (isGpu(type)) {
    const index = type.includes('.') ? type.split('.')[1] : null
    if (index !== null) return `Intel GPU (Device ${index})`
    return 'Intel integrated / discrete GPU'
  }
  if (type === 'NPU') return 'Neural Processing Unit (Intel Core Ultra)'
  return 'Always available — universal fallback'
}
