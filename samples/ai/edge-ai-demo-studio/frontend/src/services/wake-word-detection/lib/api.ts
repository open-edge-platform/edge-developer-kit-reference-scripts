// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { requireApiBase } from '@/lib/browser/api-base'
import { fetchJson, postJson } from '@/lib/browser/fetch-json'

/** This instance's v1 routes, e.g. `/api/wake-word-detection@id/v1/wake-word-detection`. */
export const wakeWordV1Base = (apiBase: string) =>
  `${apiBase}/v1/wake-word-detection`

/** Query-key builder scoped to `apiBase` so per-instance caches don't collide. */
export const wakeWordKey = (
  apiBase: string | undefined,
  ...parts: (string | number)[]
) => ['wake-word-detection', apiBase, ...parts] as const

const SERVICE_NAME = 'Wake Word Detection'

export interface Subscriber {
  id: number
  url: string
  name: string
  threshold: number
}

export interface AudioDevice {
  id: number
  name: string
}

export interface WakeWordModel {
  filename: string
  path: string
}

export interface HealthStatus {
  status: string
  model_loaded: boolean
  models: string[]
  detection_active: boolean
  subscribers: number
}

export function fetchHealth(apiBase: string | undefined) {
  requireApiBase(apiBase, SERVICE_NAME)
  return fetchJson<HealthStatus>(`${apiBase}/healthcheck`)
}

export async function fetchSubscribers(
  apiBase: string | undefined,
): Promise<Subscriber[]> {
  requireApiBase(apiBase, SERVICE_NAME)
  const data = await fetchJson<{ subscribers?: Subscriber[] }>(
    `${wakeWordV1Base(apiBase)}/webhooks/subscribers`,
  )
  return data.subscribers ?? []
}

/** The microphones the worker's host exposes, and the one it listens on. */
export async function fetchAudioDevices(apiBase: string | undefined) {
  requireApiBase(apiBase, SERVICE_NAME)
  const data = await fetchJson<{
    devices?: AudioDevice[]
    selected_device_id?: number | null
  }>(`${wakeWordV1Base(apiBase)}/audio-devices`)
  return {
    devices: data.devices ?? [],
    selectedDeviceId: data.selected_device_id ?? null,
  }
}

/** The model files on disk, and the ones loaded (by name, without `.onnx`). */
export async function fetchModels(apiBase: string | undefined) {
  requireApiBase(apiBase, SERVICE_NAME)
  const data = await fetchJson<{
    models?: WakeWordModel[]
    loaded_models?: string[]
  }>(`${wakeWordV1Base(apiBase)}/models/list`)
  return {
    models: data.models ?? [],
    loadedModels: data.loaded_models ?? [],
  }
}

/** What the worker answers a subscription with. */
export interface SubscribeResult {
  /** "Successfully subscribed…", or "URL already subscribed". */
  message?: string
  subscription?: Subscriber
}

export function subscribeWebhook(
  apiBase: string | undefined,
  params: { url: string; name?: string; threshold: number },
) {
  requireApiBase(apiBase, SERVICE_NAME)
  return postJson<SubscribeResult>(
    `${wakeWordV1Base(apiBase)}/webhooks/subscribe`,
    params,
  )
}

export function unsubscribeWebhook(apiBase: string | undefined, url: string) {
  requireApiBase(apiBase, SERVICE_NAME)
  return fetchJson(
    `${wakeWordV1Base(apiBase)}/webhooks/unsubscribe?url=${encodeURIComponent(url)}`,
    { method: 'DELETE' },
  )
}

/** How one subscriber took the test event (`POST …/webhooks/test-webhook`). */
export interface WebhookTestResult {
  url: string
  status: 'success' | 'error'
  message: string
}

/** Sends a test detection to every subscriber, one result each; rejects with no subscriber. */
export async function sendTestWebhook(
  apiBase: string | undefined,
): Promise<WebhookTestResult[]> {
  requireApiBase(apiBase, SERVICE_NAME)
  const data = await fetchJson<{ results?: WebhookTestResult[] }>(
    `${wakeWordV1Base(apiBase)}/webhooks/test-webhook`,
    { method: 'POST' },
  )
  return data.results ?? []
}

/** Starts listening; `deviceId` and `threshold` fall back to the worker's defaults. */
export function startDetection(
  apiBase: string | undefined,
  params: { deviceId?: number | null; threshold?: number } = {},
) {
  requireApiBase(apiBase, SERVICE_NAME)
  const payload: Record<string, unknown> = {}
  if (params.deviceId != null) payload.device_id = params.deviceId
  if (params.threshold != null) payload.threshold = params.threshold
  const endpoint = `${wakeWordV1Base(apiBase)}/start`
  return Object.keys(payload).length > 0
    ? postJson(endpoint, payload)
    : fetchJson(endpoint, { method: 'POST' })
}

export function stopDetection(apiBase: string | undefined) {
  requireApiBase(apiBase, SERVICE_NAME)
  return fetchJson(`${wakeWordV1Base(apiBase)}/stop`, { method: 'POST' })
}

/** Forgets the detections the worker has stored. */
export function clearDetectionEvents(apiBase: string | undefined) {
  requireApiBase(apiBase, SERVICE_NAME)
  return fetchJson<void>(`${wakeWordV1Base(apiBase)}/events`, {
    method: 'DELETE',
  })
}
