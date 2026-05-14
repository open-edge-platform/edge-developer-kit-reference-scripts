// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, type UseMutationOptions } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SetupPayload {
  host: string
  token: string
  projectId?: string
  projectName?: string
  modelId?: string | null
  verifySsl?: boolean
  device?: string
  setupType: 'cls' | 'seg' // which model to setup
}

export interface SetupResult {
  status: string
  project_id: string
  project_name: string
  labels: string[]
  model_name: string
  model_version: number | null
  model_score: number | null
  device: string
  requested_device: string
  device_confirmed: boolean
  message: string
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function setupWorker(payload: SetupPayload): Promise<SetupResult> {
  // Route to correct endpoint based on setupType
  const endpoint =
    payload.setupType === 'seg'
      ? '/api/geti-classifier/setup-seg'
      : '/api/geti-classifier/setup-cls'

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: payload.host,
      token: payload.token,
      project_id: payload.projectId ?? null,
      project_name: payload.projectName ?? null,
      model_id: payload.modelId ?? null,
      verify_ssl: payload.verifySsl ?? false,
      device: payload.device ?? 'GPU',
    }),
    signal: AbortSignal.timeout(120_000),
  })

  // ── Always read as text first ─────────────────────────────────────────────
  const raw = await res.text()

  // ── Try to parse as JSON ──────────────────────────────────────────────────
  let data: SetupResult & { detail?: string; error?: string }
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(`Server error (HTTP ${res.status}): ${raw.slice(0, 200)}`)
  }

  if (!res.ok) {
    throw new Error(
      data.detail ?? data.error ?? `Setup failed (HTTP ${res.status})`,
    )
  }

  return data
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSetup(
  options?: UseMutationOptions<SetupResult, Error, SetupPayload>,
) {
  return useMutation<SetupResult, Error, SetupPayload>({
    mutationFn: setupWorker,
    ...options,
  })
}
