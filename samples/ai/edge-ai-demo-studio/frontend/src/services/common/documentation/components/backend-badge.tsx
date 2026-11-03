// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { DocsBackend } from '@/services/types'

/** The backends a service's docs tell apart, and the selected instance's. */
export interface BackendContext {
  backends: DocsBackend[]
  /** The selected instance's backend id; absent without an instance. */
  active?: string
}

/** The labels of backend `ids`, joined for a sentence. */
export function backendLabels(ids: string[], context: BackendContext) {
  return ids
    .map((id) => context.backends.find((b) => b.id === id)?.label ?? id)
    .join(' or ')
}

/** Whether something limited to `ids` is served by the selected instance. */
export function servedByActive(
  ids: string[] | undefined,
  context: BackendContext,
): boolean | undefined {
  if (!ids?.length) return true
  if (!context.active) return undefined
  return ids.includes(context.active)
}

/** Marks an endpoint or parameter only some backends serve, and whether the selected instance does. */
export function BackendBadge({
  ids,
  context,
}: {
  ids?: string[]
  context: BackendContext
}) {
  if (!ids?.length) return null
  const served = servedByActive(ids, context)
  const label = `${backendLabels(ids, context)} only`
  return (
    <Badge
      tone={served ? 'primary' : 'muted'}
      className="max-w-full font-normal whitespace-normal"
      data-testid="docs-backend-badge"
      data-served={served === undefined ? undefined : String(served)}
    >
      {served && <Check aria-hidden="true" />}
      {served === false ? `${label} · not on this instance` : label}
    </Badge>
  )
}
