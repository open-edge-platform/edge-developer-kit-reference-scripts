// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Users } from 'lucide-react'
import { type KeyboardEvent, useRef, useState } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type {
  CoreConflict,
  CpuAffinityConflicts,
} from '@/hooks/use-cpu-affinity-conflicts'
import { cn } from '@/lib/utils'

/** P-core, E-core, or a core of a host without the hybrid split. */
export type CoreKind = 'p' | 'e' | 'flat'

export interface CoreGroup {
  kind: CoreKind
  /** Heading above the row; none for a host without the hybrid split. */
  label?: string
  helper: string
  cores: number[]
}

const KIND_NAME: Record<CoreKind, string> = {
  p: 'performance core',
  e: 'efficiency core',
  flat: '',
}

interface CoreCellProps {
  coreId: number
  kind: CoreKind
  selected: boolean
  conflicts: CoreConflict[]
  tabStop: boolean
  onActivate: (coreId: number, shiftKey: boolean) => void
  onFocus: (coreId: number) => void
  registerRef: (coreId: number, el: HTMLButtonElement | null) => void
  disabled?: boolean
}

function CoreCell({
  coreId,
  kind,
  selected,
  conflicts,
  tabStop,
  onActivate,
  onFocus,
  registerRef,
  disabled,
}: CoreCellProps) {
  const usedByOther = conflicts.length > 0
  const pinnedBy = conflicts.map((c) => c.label).join(', ')

  const ariaLabel = [
    `CPU core ${coreId}`,
    KIND_NAME[kind],
    selected ? 'selected' : 'not selected',
    usedByOther ? `also pinned by ${pinnedBy}` : '',
  ]
    .filter(Boolean)
    .join(', ')

  const cell = (
    <button
      ref={(el) => registerRef(coreId, el)}
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={ariaLabel}
      data-core-id={coreId}
      data-testid={`cpu-core-${coreId}`}
      tabIndex={tabStop ? 0 : -1}
      onClick={(e) => {
        if (!disabled) onActivate(coreId, e.shiftKey)
      }}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onActivate(coreId, e.shiftKey)
        }
      }}
      onFocus={() => onFocus(coreId)}
      disabled={disabled}
      className={cn(
        'relative flex h-7 w-7 shrink-0 items-center justify-center font-mono text-[10px] tabular-nums transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
        // Shape + border pattern carry the P/E distinction without relying on colour.
        kind === 'e'
          ? 'rounded-full border border-dashed'
          : 'rounded-sm border',
        selected
          ? 'bg-primary text-primary-foreground border-primary ring-primary/40 ring-1'
          : 'bg-muted/30 text-foreground hover:bg-muted',
        usedByOther && 'border-warning border-dotted',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {coreId}
      {usedByOther && (
        <Users
          aria-hidden="true"
          className={cn(
            'bg-background absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full p-px',
            selected ? 'text-primary-foreground' : 'text-warning',
          )}
        />
      )}
    </button>
  )

  if (!usedByOther && kind === 'flat' && !selected) return cell

  return (
    <Tooltip>
      <TooltipTrigger asChild>{cell}</TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="space-y-0.5">
          <div className="font-medium">
            Core {coreId}
            {kind === 'p' && ' · P-core'}
            {kind === 'e' && ' · E-core'}
          </div>
          {selected && <div>Selected for this instance</div>}
          {usedByOther && <div>Pinned by: {pinnedBy}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/** The per-core picker: one row per group, one tab stop (roving tabindex), Shift for a range. */
export function CpuCoreGrid({
  groups,
  selected,
  conflicts,
  onActivate,
  disabled,
}: {
  groups: CoreGroup[]
  selected: ReadonlySet<number>
  conflicts: CpuAffinityConflicts
  onActivate: (coreId: number, shiftKey: boolean) => void
  disabled?: boolean
}) {
  const order = groups.flatMap((g) => g.cores)
  const [focusedCore, setFocusedCore] = useState<number | null>(null)
  // Derived, so a grid whose cores load after it mounts still has a tab stop.
  const tabStop =
    focusedCore !== null && order.includes(focusedCore) ? focusedCore : order[0]
  const cellRefs = useRef(new Map<number, HTMLButtonElement>())
  const registerRef = (coreId: number, el: HTMLButtonElement | null) => {
    if (el) cellRefs.current.set(coreId, el)
    else cellRefs.current.delete(coreId)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = tabStop === undefined ? -1 : order.indexOf(tabStop)
    if (idx === -1) return
    let next: number
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = Math.max(0, idx - 1)
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
      next = Math.min(order.length - 1, idx + 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = order.length - 1
    else return
    e.preventDefault()
    setFocusedCore(order[next])
    cellRefs.current.get(order[next])?.focus()
  }

  return (
    <div
      role="group"
      aria-label="CPU cores"
      onKeyDown={handleKeyDown}
      className="space-y-3"
    >
      {groups
        .filter((group) => group.cores.length > 0)
        .map((group) => (
          <div key={group.kind} className="space-y-1.5">
            {group.label && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                  {group.label}
                </p>
                <span className="text-muted-foreground text-xs">
                  {group.helper}
                </span>
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              {group.cores.map((coreId) => (
                <CoreCell
                  key={coreId}
                  coreId={coreId}
                  kind={group.kind}
                  selected={selected.has(coreId)}
                  conflicts={conflicts[coreId] ?? []}
                  tabStop={tabStop === coreId}
                  onActivate={onActivate}
                  onFocus={setFocusedCore}
                  registerRef={registerRef}
                  disabled={disabled}
                />
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}

/** What the grid's shapes and marks mean. */
export function CpuCoreLegend({ hybrid }: { hybrid: boolean }) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {hybrid && (
        <>
          <span className="flex items-center gap-1">
            <span className="border-border bg-muted/30 inline-block h-3 w-3 rounded-sm border" />
            P-core
          </span>
          <span className="flex items-center gap-1">
            <span className="border-border bg-muted/30 inline-block h-3 w-3 rounded-full border border-dashed" />
            E-core
          </span>
        </>
      )}
      <span className="flex items-center gap-1">
        <span className="bg-primary inline-block h-3 w-3 rounded-sm" />
        Selected
      </span>
      <span className="flex items-center gap-1">
        <span className="border-warning bg-warning/10 inline-block h-3 w-3 rounded-sm border border-dotted" />
        <Users aria-hidden="true" className="text-warning h-2.5 w-2.5" />
        Used by other instances
      </span>
    </div>
  )
}
