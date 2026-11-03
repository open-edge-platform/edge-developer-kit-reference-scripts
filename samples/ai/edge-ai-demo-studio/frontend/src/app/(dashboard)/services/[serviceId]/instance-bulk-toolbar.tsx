// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, Power, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

/** Manage instances bulk bar; Start/Stop show a count when they cover only some selected rows. */
export function InstanceBulkToolbar({
  selectedCount,
  allChecked,
  onCheckAll,
  startCount,
  stopCount,
  starting,
  stopping,
  onStart,
  onStop,
}: {
  selectedCount: number
  allChecked: boolean
  onCheckAll: (checked: boolean) => void
  /** Selected instances a Start applies to (those not running). */
  startCount: number
  /** Selected instances a Stop applies to (those running). */
  stopCount: number
  starting: boolean
  stopping: boolean
  onStart: () => void
  onStop: () => void
}) {
  const busy = starting || stopping
  return (
    <div
      className="border-border bg-muted/30 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-2"
      data-testid="instance-bulk-toolbar"
    >
      <label className="flex items-center gap-2 text-xs font-medium">
        <Checkbox
          checked={
            allChecked ? true : selectedCount > 0 ? 'indeterminate' : false
          }
          onCheckedChange={(state) => onCheckAll(state === true)}
          aria-label="Select all instances"
        />
        {selectedCount > 0 ? `${selectedCount} selected` : 'Select'}
      </label>
      {selectedCount > 0 && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || startCount === 0}
            onClick={onStart}
            data-testid="start-selected-instances"
          >
            {starting ? (
              <Loader className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Power className="h-3.5 w-3.5" />
            )}
            Start selected
            {startCount > 0 && startCount < selectedCount
              ? ` (${startCount})`
              : ''}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || stopCount === 0}
            onClick={onStop}
            data-testid="stop-selected-instances"
          >
            {stopping ? (
              <Loader className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3 w-3" />
            )}
            Stop selected
            {stopCount > 0 && stopCount < selectedCount
              ? ` (${stopCount})`
              : ''}
          </Button>
        </div>
      )}
    </div>
  )
}
