// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { serviceConfig } from '../config'

/** Splits a comma-joined `models.default.name` into its ONNX filenames. */
export function parseModelNames(name: string | undefined): string[] {
  return (name ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Same values, order ignored: reordering the same wake words is not a change worth saving. */
export function sameModelSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((v) => set.has(v))
}

/**
 * A wake word's display name: a preset's label (by file or loaded name, `hey_jarvis_v0.1`), else
 * the name tidied (`my_word_v2.0` → `my word`).
 */
export function wakeWordLabel(model: string): string {
  const preset = serviceConfig.availableModels?.find(
    (m) => m.value === model || m.value === `${model}.onnx`,
  )
  if (preset) return preset.label
  return model
    .replace(/\.onnx$/, '')
    .replace(/_/g, ' ')
    .replace(/v\d+\.\d+/, '')
    .trim()
}
