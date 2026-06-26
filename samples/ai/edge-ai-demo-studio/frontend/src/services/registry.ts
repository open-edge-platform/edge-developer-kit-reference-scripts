// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type {
  ApiEndpoint,
  ApiParam,
  CodeSample,
  ExecutionMode,
  LogLevel,
  LogSource,
  Service,
  ServiceDocsData,
  ServiceMeta,
  ServiceMetrics,
  ServiceStatus,
} from './types'

import type { OS } from '@/types/common'
import { serviceMap } from './_generated/services'
import type { Service } from './types'

// ─── Aggregated Exports ───────────────────────────────────────────
export const services: Service[] = Object.values(serviceMap)

/** Services visible in the UI (excludes hidden services) */
export const visibleServices: Service[] = services.filter((s) => !s.hidden)

export function getServiceById(id: string): Service | undefined {
  if (!(id in serviceMap)) return undefined
  return serviceMap[id as keyof typeof serviceMap]
}

// ─── OS / Device compatibility helpers ─────────────────────────────

/** Check if a service supports the given OS */
export function isServiceSupportedOnOS(service: Service, os: OS): boolean {
  return service.supportedOS.includes(os)
}

// Re-export from shared location for backward compatibility
export { getOSLabel } from '@/types/common'
