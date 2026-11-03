// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Defaults and bounds for the `app-settings` global. Imports nothing: both the Payload global config
 * and `@payload-config`-dependent code read it, which would otherwise form an import cycle.
 */

export const APP_SETTINGS_DEFAULTS = {
  hfToken: '',
  /** Seconds a service may take to come up before it is declared failed. */
  startupTimeout: 600,
  theme: 'system',
  /** Seconds the instance proxy lets a worker go without sending anything. */
  proxyTimeout: 300,
} as const

/** Lower bound shared by both timeout fields. */
export const MIN_TIMEOUT_SECONDS = 30

export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]

export function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme)
}

/** Rounds a user-supplied timeout and holds it at or above the field minimum. */
export function clampTimeout(value: unknown, fallback: number): number {
  const seconds =
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(MIN_TIMEOUT_SECONDS, Math.round(seconds))
}
