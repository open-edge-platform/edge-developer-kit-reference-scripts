// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** A voice a text-to-speech model offers. */
export interface VoiceInfo {
  /** What the worker is asked for (`voice`). */
  id: string
  label: string
  /** Language (and region) it speaks, as the voice list groups it. */
  language: string
}
