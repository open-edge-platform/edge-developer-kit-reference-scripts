// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { type KeyboardEvent, useRef, useState } from 'react'
import { ConfigSection } from '@/components/configure/config-section'
import {
  type CoreGroup,
  CpuCoreGrid,
  CpuCoreLegend,
} from '@/components/configure/cpu-core-grid'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSystemInfo } from '@/context/system-info-context'
import { useCpuAffinityConflicts } from '@/hooks/use-cpu-affinity-conflicts'
import { plural } from '@/lib/browser/format'
import {
  formatCpuAffinity,
  parseCpuAffinity,
  supportsCpuAffinity,
} from '@/lib/instances/cpu-affinity'
import { cn } from '@/lib/utils'

type PresetKey = 'all' | 'p' | 'e'

interface AffinityPreset {
  key: PresetKey
  label: string
  desc: string
  cores: number[]
}

function setEqualsList(
  set: ReadonlySet<number>,
  list: readonly number[] | undefined,
): boolean {
  if (!list || set.size !== list.length) return false
  for (const id of list) if (!set.has(id)) return false
  return true
}

/**
 * The selection after activating `coreId`: a toggle, or with a Shift-range `anchor`, every core
 * between the two set to the anchor's state. Starts from the actual selection, never the implicit
 * "all cores" of a cleared value, so a click after Clear picks exactly one core.
 */
function nextSelection(
  selected: ReadonlySet<number>,
  allCores: readonly number[],
  coreId: number,
  anchor: number | null,
): Set<number> {
  const next = new Set(selected)
  if (anchor !== null) {
    const select = next.has(anchor)
    const lo = Math.min(anchor, coreId)
    const hi = Math.max(anchor, coreId)
    for (const c of allCores) {
      if (c < lo || c > hi) continue
      if (select) next.add(c)
      else next.delete(c)
    }
  } else if (next.has(coreId)) {
    next.delete(coreId)
  } else {
    next.add(coreId)
  }
  return next
}

export interface CpuAffinitySectionProps {
  /** numactl -C string; empty = "use all cores". */
  value: string
  onChange: (next: string) => void
  /** `type@instanceId` being edited, so its own cores don't show as taken; `undefined` for a draft. */
  currentInstanceKey: string | undefined
  disabled?: boolean
}

/**
 * Pins an instance's process to CPU cores (`numactl -C` on Linux, an affinity mask on Windows):
 * presets plus a per-core grid. Renders nothing on other platforms.
 */
export function CpuAffinitySection({
  value,
  onChange,
  currentInstanceKey,
  disabled,
}: CpuAffinitySectionProps) {
  const { systemInfo } = useSystemInfo()
  const conflicts = useCpuAffinityConflicts(currentInstanceKey)

  const cpuCount = systemInfo?.cpuCount ?? 0
  const pCoreIds = systemInfo?.pCoreIds ?? []
  const eCoreIds = systemInfo?.eCoreIds ?? []
  const isHybrid = pCoreIds.length > 0 && eCoreIds.length > 0
  const allCores = isHybrid
    ? [...pCoreIds, ...eCoreIds].sort((a, b) => a - b)
    : Array.from({ length: cpuCount }, (_, i) => i)

  const selected = parseCpuAffinity(value)
  // Cleared (no pinning) renders with no cell filled, so Clear is unambiguous.
  const isCleared = value.trim() === ''

  // An explicit full selection ("0-N") counts as "all" alongside the unpinned default.
  const activePreset: PresetKey | 'custom' =
    isCleared || setEqualsList(selected, allCores)
      ? 'all'
      : isHybrid && setEqualsList(selected, pCoreIds)
        ? 'p'
        : isHybrid && setEqualsList(selected, eCoreIds)
          ? 'e'
          : 'custom'

  // The grid starts open for a custom selection. Decided once the core list
  // has loaded (before that every value looks custom).
  const [advancedOpen, setAdvancedOpen] = useState<boolean | null>(null)
  if (advancedOpen === null && allCores.length > 0) {
    setAdvancedOpen(activePreset === 'custom')
  }

  // Shift-click range anchor: the last core toggled on its own.
  const anchorRef = useRef<number | null>(null)

  if (!supportsCpuAffinity(systemInfo?.os)) return null

  const emit = (cores: Iterable<number>) => onChange(formatCpuAffinity(cores))

  const handleActivate = (coreId: number, shiftKey: boolean) => {
    const anchor = shiftKey ? anchorRef.current : null
    if (anchor === null) anchorRef.current = coreId
    emit(nextSelection(selected, allCores, coreId, anchor))
  }

  const presets: AffinityPreset[] = [
    {
      key: 'all',
      label: 'All cores',
      desc: plural(allCores.length || cpuCount, 'core'),
      // Explicitly pin to every core (fills the grid). Clear removes pinning.
      cores: allCores,
    },
    ...(isHybrid
      ? [
          {
            key: 'p' as const,
            label: 'P-cores',
            desc: `${pCoreIds.length} performance`,
            cores: pCoreIds,
          },
          {
            key: 'e' as const,
            label: 'E-cores',
            desc: `${eCoreIds.length} efficient`,
            cores: eCoreIds,
          },
        ]
      : []),
  ]

  const applyPreset = (preset: AffinityPreset) => {
    // A later Shift range starts fresh.
    anchorRef.current = null
    emit(preset.cores)
  }

  // A radio group: arrow keys move the choice, as the role promises.
  const handlePresetKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (step === 0 || disabled) return
    e.preventDefault()
    const current = presets.findIndex((p) => p.key === activePreset)
    const next =
      presets[(Math.max(current, 0) + step + presets.length) % presets.length]
    applyPreset(next)
    e.currentTarget
      .querySelector<HTMLButtonElement>(`[data-preset="${next.key}"]`)
      ?.focus()
  }

  const groups: CoreGroup[] = isHybrid
    ? [
        {
          kind: 'p',
          label: 'P-cores',
          helper: `${pCoreIds.length} performance · solid`,
          cores: pCoreIds,
        },
        {
          kind: 'e',
          label: 'E-cores',
          helper: `${eCoreIds.length} efficient · dashed`,
          cores: eCoreIds,
        },
      ]
    : [
        {
          kind: 'flat',
          helper: plural(allCores.length, 'core'),
          cores: allCores,
        },
      ]

  return (
    // A shorter delay than the app's: the grid is scanned cell by cell.
    <TooltipProvider delayDuration={250}>
      <ConfigSection
        title="CPU Affinity"
        aside={
          <span className="text-muted-foreground text-xs">
            {activePreset === 'all'
              ? 'all cores'
              : `${selected.size} / ${allCores.length || cpuCount} cores`}
          </span>
        }
      >
        <div
          role="radiogroup"
          aria-label="CPU affinity preset"
          onKeyDown={handlePresetKeyDown}
          className={cn(
            'grid gap-1.5',
            presets.length === 3 ? 'grid-cols-3' : 'grid-cols-1',
          )}
        >
          {presets.map((p) => {
            const active = activePreset === p.key
            // Roving tab stop: the checked preset, else the first.
            const tabStop =
              active || (activePreset === 'custom' && p.key === 'all')
            return (
              <Button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={tabStop ? 0 : -1}
                data-preset={p.key}
                size="sm"
                variant={active ? 'default' : 'outline'}
                disabled={disabled}
                onClick={() => applyPreset(p)}
                className="h-auto flex-col items-start gap-0.5 px-2.5 py-1.5"
              >
                <span className="text-xs font-medium">{p.label}</span>
                <span
                  className={cn(
                    'text-xs font-normal',
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
                    className="px-1.5 py-0 text-xs font-medium"
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
                  className="h-8 px-3 text-xs"
                  disabled={disabled}
                  onClick={() => {
                    anchorRef.current = null
                    onChange('')
                  }}
                  title="Clear the selection (process scheduled on all cores)"
                >
                  Clear
                </Button>
              </div>

              <CpuCoreGrid
                groups={groups}
                selected={selected}
                conflicts={conflicts}
                onActivate={handleActivate}
                disabled={disabled}
              />

              <CpuCoreLegend hybrid={isHybrid} />

              <p className="text-muted-foreground text-xs leading-snug">
                Click a core to toggle it; shift-click to select a range.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </ConfigSection>
    </TooltipProvider>
  )
}
