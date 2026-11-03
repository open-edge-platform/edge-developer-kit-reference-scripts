// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { engines } from '@/engines/registry'
import type { LogSource, Service } from '@/services/types'
import { pollingPath } from './log-message'

/** What the app polls on this instance: its health check, engine health probe and API log sources. */
export function getPollingPaths(
  service: Service,
  logSources: LogSource[],
): string[] {
  const engine = service.engine ? engines[service.engine] : undefined
  const urls = [
    service.healthCheck?.url,
    engine?.healthUrl,
    ...logSources.filter((s) => s.type === 'api').map((s) => s.target),
  ]
  return [
    ...new Set(urls.filter((url): url is string => !!url).map(pollingPath)),
  ]
}
