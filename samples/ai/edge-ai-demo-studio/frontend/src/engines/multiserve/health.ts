// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** The engine's health probe, on its own port. */
export const MULTISERVE_HEALTH_URL = '/v1/health'

/**
 * True when `/v1/health` reports both backends OK, so the engine can start a model on either. Says
 * nothing about model servers, which start with their models.
 */
export function isMultiserveHealthy(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const health = (data as { health?: unknown }).health
  if (typeof health !== 'object' || health === null) return false
  const status = health as Record<string, unknown>
  return status['llama.cpp'] === 'OK' && status.ovms === 'OK'
}
