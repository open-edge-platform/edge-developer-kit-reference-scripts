// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Keys of a demo's session state, so drafts, parameters and results come back per instance. */

interface DemoSessionTarget {
  /** The service type. */
  id: string
  /** `type@instanceId`; unset only for a view with no row. */
  instanceKey?: string
}

/** The instance key, or the bare type for a view that has no row yet. */
export function demoSessionKey(service: DemoSessionTarget): string {
  return service.instanceKey ?? service.id
}

/**
 * The key of one piece of a demo's session state, e.g.
 * `demoStateKey(service, 'tts:input')` → `text-to-speech@gpu:tts:input`.
 */
export function demoStateKey(service: DemoSessionTarget, name: string): string {
  return `${demoSessionKey(service)}:${name}`
}
