// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'
import { InfoTip } from '@/components/common/info-tip'

/** One figure of the Live metrics panel: its name, value and detail line. */
export function StatTile({
  id,
  label,
  value,
  detail,
  tip,
}: {
  /** The figure's id; the tile's test id is `metric-<id>`. */
  id: string
  label: string
  value: string
  detail: ReactNode
  tip: string
}) {
  return (
    <div
      className="border-border bg-background/60 min-w-0 rounded-lg border p-3"
      data-testid={`metric-${id}`}
    >
      <div className="flex items-center gap-1">
        <p className="text-muted-foreground text-xs font-medium">{label}</p>
        <InfoTip
          size="sm"
          ariaLabel={`About ${label.toLowerCase()}`}
          contentClassName="max-w-64"
          tooltip={tip}
        />
      </div>
      <p className="text-foreground mt-1 text-xl font-semibold tracking-tight">
        {value}
      </p>
      <div className="text-muted-foreground mt-1 min-w-0 text-xs break-words">
        {detail}
      </div>
    </div>
  )
}
