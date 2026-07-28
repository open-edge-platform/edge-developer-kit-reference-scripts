// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Users } from 'lucide-react'
import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSystemInfo } from '@/context/system-info-context'
import { useServicesQuery } from '@/hooks/use-services'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// numactl -C accepts comma-separated CPU IDs and ranges, e.g. "0-7", "0,2,4-6".
export const CPU_AFFINITY_RE = /^\s*\d+(-\d+)?(\s*,\s*\d+(-\d+)?)*\s*$/

/** True iff `value` is empty or a valid numactl -C list. */
export function isCpuAffinityValid(value: string): boolean {
  const trimmed = value.trim()
  return trimmed === '' || CPU_AFFINITY_RE.test(trimmed)
}

/** Strip whitespace from a numactl -C list. */
export function normalizeCpuAffinity(value: string): string {
  return value.trim().replace(/\s+/g, '')
}

/** Expand a numactl -C list to a Set of CPU IDs. Ignores invalid input. */
export function parseCpuAffinity(value: string): Set<number> {
  const out = new Set<number>()
  const trimmed = value.trim()
  if (!trimmed) return out
  if (!CPU_AFFINITY_RE.test(trimmed)) return out
  for (const part of trimmed.split(',')) {
    const seg = part.trim()
    if (!seg) continue
    if (seg.includes('-')) {
      const [lo, hi] = seg.split('-').map((n) => Number(n.trim()))
      if (Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi) {
        for (let i = lo; i <= hi; i++) out.add(i)
      }
    } else {
      const n = Number(seg)
      if (Number.isFinite(n)) out.add(n)
    }
  }
  return out
}

/** Collapse a set of CPU IDs to a canonical numactl -C list ("0-7,9,11-13"). */
export function formatCpuAffinity(cores: Iterable<number>): string {
  const sorted = [...new Set(cores)]
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const segments: string[] = []
  let runStart = sorted[0]
  let runEnd = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === runEnd + 1) {
      runEnd = sorted[i]
    } else {
      segments.push(
        runStart === runEnd ? `${runStart}` : `${runStart}-${runEnd}`,
      )
      runStart = sorted[i]
      runEnd = sorted[i]
    }
  }
  segments.push(runStart === runEnd ? `${runStart}` : `${runStart}-${runEnd}`)
  return segments.join(',')
}

interface ConflictMap {
  /** coreId → list of service IDs (excluding the current service) pinning it. */
  [coreId: number]: string[]
}

/**
 * Aggregates CPU affinities from every persisted service except the current
 * one, so callers can highlight overlap in the grid.
 */
export function useCpuAffinityConflicts(currentServiceId?: string): {
  conflicts: ConflictMap
  serviceLabels: Record<string, string>
} {
  const { serviceInfoMap } = useServicesQuery()

  return useMemo(() => {
    const conflicts: ConflictMap = {}
    const serviceLabels: Record<string, string> = {}
    for (const [type, info] of Object.entries(serviceInfoMap)) {
      if (type === currentServiceId) continue
      const affinity = (info.metadata as { cpuAffinity?: string } | undefined)
        ?.cpuAffinity
      if (!affinity) continue
      serviceLabels[type] = type
      for (const core of parseCpuAffinity(affinity)) {
        ;(conflicts[core] ??= []).push(type)
      }
    }
    return { conflicts, serviceLabels }
  }, [serviceInfoMap, currentServiceId])
}

interface CoreCellProps {
  coreId: number
  kind: 'p' | 'e' | 'flat'
  selected: boolean
  conflicts: string[]
  isFocused: boolean
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
  isFocused,
  onActivate,
  onFocus,
  registerRef,
  disabled,
}: CoreCellProps) {
  const usedByOther = conflicts.length > 0
  const handleClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (disabled) return
    onActivate(coreId, e.shiftKey)
  }
  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      onActivate(coreId, e.shiftKey)
    }
  }

  const ariaParts: string[] = [
    `CPU core ${coreId}`,
    kind === 'p' ? 'performance core' : kind === 'e' ? 'efficiency core' : '',
    selected ? 'selected' : 'not selected',
    usedByOther
      ? `also pinned by ${conflicts.length} other service${
          conflicts.length === 1 ? '' : 's'
        }`
      : '',
  ].filter(Boolean)

  const cell = (
    <button
      ref={(el) => registerRef(coreId, el)}
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={ariaParts.join(', ')}
      data-core-id={coreId}
      data-testid={`cpu-core-${coreId}`}
      tabIndex={isFocused ? 0 : -1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onFocus={() => onFocus(coreId)}
      disabled={disabled}
      className={cn(
        'relative flex h-7 w-7 shrink-0 items-center justify-center font-mono text-[10px] tabular-nums transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
        // Shape + border pattern carry the P/E distinction without relying on colour.
        kind === 'p' && 'rounded-sm border',
        kind === 'e' && 'rounded-full border border-dashed',
        kind === 'flat' && 'rounded-sm border',
        // Free / selected fill.
        selected
          ? 'bg-primary text-primary-foreground border-primary ring-primary/40 ring-1'
          : 'bg-muted/30 text-foreground hover:bg-muted',
        // Conflict overlay (used by another service).
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
      <TooltipContent side="top" className="text-[11px]">
        <div className="space-y-0.5">
          <div className="font-medium">
            Core {coreId}
            {kind === 'p' && ' · P-core'}
            {kind === 'e' && ' · E-core'}
          </div>
          {selected && <div>Selected for this service</div>}
          {usedByOther && (
            <div>Pinned by: {conflicts.map((s) => `${s}`).join(', ')}</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

interface CoreGridProps {
  label: string
  helper: string
  cores: number[]
  kind: 'p' | 'e' | 'flat'
  selectedSet: Set<number>
  conflicts: ConflictMap
  focusedCore: number | null
  onActivate: (coreId: number, shiftKey: boolean) => void
  onFocus: (coreId: number) => void
  registerRef: (coreId: number, el: HTMLButtonElement | null) => void
  disabled?: boolean
}

function CoreGrid({
  label,
  helper,
  cores,
  kind,
  selectedSet,
  conflicts,
  focusedCore,
  onActivate,
  onFocus,
  registerRef,
  disabled,
}: CoreGridProps) {
  if (cores.length === 0) return null
  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            {label}
          </p>
          <span className="text-muted-foreground/70 text-[10px]">{helper}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {cores.map((coreId) => (
          <CoreCell
            key={coreId}
            coreId={coreId}
            kind={kind}
            selected={selectedSet.has(coreId)}
            conflicts={conflicts[coreId] ?? []}
            isFocused={focusedCore === coreId}
            onActivate={onActivate}
            onFocus={onFocus}
            registerRef={registerRef}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  )
}

/** True iff `set` contains exactly the ids in `list` (same size, same members). */
function setEqualsList(set: Set<number>, list: number[] | undefined): boolean {
  if (!list || set.size !== list.length) return false
  for (const id of list) if (!set.has(id)) return false
  return true
}

export interface CpuAffinitySectionProps {
  /** numactl -C string; empty = "use all cores". */
  value: string
  onChange: (next: string) => void
  /** Service whose affinity is being edited — excluded from conflicts UI. */
  currentServiceId?: string
  disabled?: boolean
}

/**
 * Lets the user pin a service's process to specific CPU cores via `numactl -C`
 * by clicking individual cores in a grid. On Intel-hybrid Linux hosts the
 * grid is split into P-cores and E-cores. Linux-only — the section returns
 * null on other platforms because numactl isn't available there.
 */
export function CpuAffinitySection({
  value,
  onChange,
  currentServiceId,
  disabled,
}: CpuAffinitySectionProps) {
  const { systemInfo } = useSystemInfo()
  const { conflicts } = useCpuAffinityConflicts(currentServiceId)

  const isLinux = systemInfo?.os === 'linux'
  const cpuCount = systemInfo?.cpuCount ?? 0
  const pCoreIds = systemInfo?.pCoreIds
  const eCoreIds = systemInfo?.eCoreIds
  const isHybrid =
    !!pCoreIds && !!eCoreIds && pCoreIds.length > 0 && eCoreIds.length > 0

  const allCores = useMemo(() => {
    if (isHybrid) {
      return [...(pCoreIds ?? []), ...(eCoreIds ?? [])].sort((a, b) => a - b)
    }
    return Array.from({ length: cpuCount }, (_, i) => i)
  }, [isHybrid, pCoreIds, eCoreIds, cpuCount])

  const flatCores = useMemo(
    () => (isHybrid ? [] : allCores),
    [isHybrid, allCores],
  )

  const selectedSet = useMemo(() => parseCpuAffinity(value), [value])
  // Cleared / "no pinning" — runtime falls back to all cores, but the grid
  // should render with zero cells filled so [Clear] is unambiguous.
  const isCleared = value.trim() === ''

  // The "Advanced" grid starts collapsed unless the persisted value is a custom
  // selection (i.e. not All / P-cores / E-cores), in which case we open it so
  // the user can see what was pinned.
  const [advancedOpen, setAdvancedOpen] = useState(() => {
    const sel = parseCpuAffinity(value)
    if (value.trim() === '' || setEqualsList(sel, allCores)) return false
    if (
      isHybrid &&
      (setEqualsList(sel, pCoreIds) || setEqualsList(sel, eCoreIds))
    ) {
      return false
    }
    return true
  })

  // Roving tab index — only the focused cell is tab-stoppable.
  const [focusedCore, setFocusedCore] = useState<number | null>(
    allCores[0] ?? null,
  )
  const lastAnchorRef = useRef<number | null>(null)
  const cellRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
  const registerRef = useCallback(
    (coreId: number, el: HTMLButtonElement | null) => {
      if (el) cellRefs.current.set(coreId, el)
      else cellRefs.current.delete(coreId)
    },
    [],
  )

  const emit = useCallback(
    (nextSet: Set<number>) => {
      onChange(formatCpuAffinity(nextSet))
    },
    [onChange],
  )

  const handleActivate = useCallback(
    (coreId: number, shiftKey: boolean) => {
      // Start from the actual current selection — never the implicit "all cores"
      // shown for cleared state, so clicking a single core after [Clear] selects
      // exactly that one core (not "all except this one").
      const next = new Set(selectedSet)
      if (shiftKey && lastAnchorRef.current !== null) {
        // Set the range to whatever state the anchor will end up in.
        const anchor = lastAnchorRef.current
        const anchorWillBeSelected = !next.has(anchor)
        const lo = Math.min(anchor, coreId)
        const hi = Math.max(anchor, coreId)
        for (const c of allCores) {
          if (c < lo || c > hi) continue
          if (anchorWillBeSelected) next.add(c)
          else next.delete(c)
        }
      } else {
        if (next.has(coreId)) next.delete(coreId)
        else next.add(coreId)
        lastAnchorRef.current = coreId
      }
      emit(next)
    },
    [selectedSet, allCores, emit],
  )

  const moveFocus = useCallback((coreId: number) => {
    setFocusedCore(coreId)
    cellRefs.current.get(coreId)?.focus()
  }, [])

  const handleGridKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (focusedCore === null) return
      const idx = allCores.indexOf(focusedCore)
      if (idx === -1) return
      let nextIdx = idx
      if (e.key === 'ArrowLeft') nextIdx = Math.max(0, idx - 1)
      else if (e.key === 'ArrowRight')
        nextIdx = Math.min(allCores.length - 1, idx + 1)
      else if (e.key === 'Home') nextIdx = 0
      else if (e.key === 'End') nextIdx = allCores.length - 1
      else return
      e.preventDefault()
      moveFocus(allCores[nextIdx])
    },
    [allCores, focusedCore, moveFocus],
  )

  if (!isLinux) return null

  const selectionSize = selectedSet.size

  // Which of the three headline presets the current value corresponds to.
  // An explicit full selection ("0-N") counts as "all" alongside the empty
  // (unpinned) default. Anything else is a bespoke per-core selection.
  const activePreset: 'all' | 'p' | 'e' | 'custom' =
    isCleared || setEqualsList(selectedSet, allCores)
      ? 'all'
      : isHybrid && setEqualsList(selectedSet, pCoreIds)
        ? 'p'
        : isHybrid && setEqualsList(selectedSet, eCoreIds)
          ? 'e'
          : 'custom'

  const presets: {
    key: 'all' | 'p' | 'e'
    label: string
    desc: string
    apply: () => void
  }[] = [
    {
      key: 'all',
      label: 'All cores',
      desc: `${allCores.length || cpuCount} cores`,
      // Explicitly pin to every core (fills the grid). Use Clear to remove
      // pinning entirely.
      apply: () => emit(new Set(allCores)),
    },
    ...(isHybrid
      ? [
          {
            key: 'p' as const,
            label: 'P-cores',
            desc: `${pCoreIds?.length ?? 0} performance`,
            apply: () => emit(new Set(pCoreIds ?? [])),
          },
          {
            key: 'e' as const,
            label: 'E-cores',
            desc: `${eCoreIds?.length ?? 0} efficient`,
            apply: () => emit(new Set(eCoreIds ?? [])),
          },
        ]
      : []),
  ]

  return (
    <TooltipProvider delayDuration={250}>
      <div className="space-y-3 px-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            CPU Affinity
          </p>
          <span className="text-muted-foreground text-[10px]">
            {activePreset === 'all'
              ? 'all cores'
              : `${selectionSize} / ${allCores.length || cpuCount} cores`}
          </span>
        </div>

        {/* Headline presets — the common choices, always visible. */}
        <div
          role="radiogroup"
          aria-label="CPU affinity preset"
          className={cn(
            'grid gap-1.5',
            presets.length === 3 ? 'grid-cols-3' : 'grid-cols-1',
          )}
        >
          {presets.map((p) => {
            const active = activePreset === p.key
            return (
              <Button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={active}
                size="sm"
                variant={active ? 'default' : 'outline'}
                disabled={disabled}
                onClick={() => {
                  // Reset the shift-click anchor so a later range starts fresh.
                  lastAnchorRef.current = null
                  p.apply()
                }}
                className="h-auto flex-col items-start gap-0.5 px-2.5 py-1.5"
              >
                <span className="text-xs font-medium">{p.label}</span>
                <span
                  className={cn(
                    'text-[10px] font-normal',
                    active
                      ? 'text-primary-foreground/80'
                      : 'text-muted-foreground',
                  )}
                >
                  {p.desc}
                </span>
              </Button>
            )
          })}
        </div>

        {/* Advanced — per-core grid + raw numactl editor, collapsed by default. */}
        <Accordion
          type="single"
          collapsible
          value={advancedOpen ? 'advanced' : ''}
          onValueChange={(v) => setAdvancedOpen(v === 'advanced')}
        >
          <AccordionItem value="advanced">
            <AccordionTrigger className="py-2 text-xs">
              <span className="flex items-center gap-2">
                Advanced — select individual cores
                {activePreset === 'custom' && (
                  <Badge
                    variant="secondary"
                    className="h-4 px-1.5 text-[9px] font-medium"
                  >
                    Custom
                  </Badge>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  disabled={disabled}
                  onClick={() => {
                    lastAnchorRef.current = null
                    onChange('')
                  }}
                  title="Clear the selection (process scheduled on all cores)"
                >
                  Clear
                </Button>
              </div>

              <div
                role="group"
                aria-label="CPU cores"
                onKeyDown={handleGridKeyDown}
                className="space-y-3"
              >
                {isHybrid ? (
                  <>
                    <CoreGrid
                      label="P-cores"
                      helper={`${pCoreIds?.length ?? 0} performance · solid`}
                      cores={pCoreIds ?? []}
                      kind="p"
                      selectedSet={selectedSet}
                      conflicts={conflicts}
                      focusedCore={focusedCore}
                      onActivate={handleActivate}
                      onFocus={setFocusedCore}
                      registerRef={registerRef}
                      disabled={disabled}
                    />
                    <CoreGrid
                      label="E-cores"
                      helper={`${eCoreIds?.length ?? 0} efficient · dashed`}
                      cores={eCoreIds ?? []}
                      kind="e"
                      selectedSet={selectedSet}
                      conflicts={conflicts}
                      focusedCore={focusedCore}
                      onActivate={handleActivate}
                      onFocus={setFocusedCore}
                      registerRef={registerRef}
                      disabled={disabled}
                    />
                  </>
                ) : (
                  <CoreGrid
                    label=""
                    helper={`${flatCores.length} cores`}
                    cores={flatCores}
                    kind="flat"
                    selectedSet={selectedSet}
                    conflicts={conflicts}
                    focusedCore={focusedCore}
                    onActivate={handleActivate}
                    onFocus={setFocusedCore}
                    registerRef={registerRef}
                    disabled={disabled}
                  />
                )}
              </div>

              {/* Legend */}
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                {isHybrid && (
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
                  <Users className="text-warning h-2.5 w-2.5" />
                  Used by other
                </span>
              </div>

              <p className="text-muted-foreground text-[10px] leading-snug">
                Click a core to toggle it; shift-click to select a range.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </TooltipProvider>
  )
}
