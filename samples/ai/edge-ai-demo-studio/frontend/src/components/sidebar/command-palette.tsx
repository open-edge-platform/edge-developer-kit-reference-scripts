// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { CornerDownLeft, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { navigateWithLeaveGuard } from '@/components/common/leave-guard'
import { shapedStatusDotClass } from '@/components/common/tones'
import { useInterruptionGuard } from '@/components/services/instance-lifecycle'
import { APP_PAGES } from '@/components/shell/app-pages'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useServiceStatus } from '@/context/service-status-context'
import { resolveServiceInfo } from '@/hooks/use-services'
import { useServiceShortcuts } from '@/hooks/use-service-shortcuts'
import { STATE_LABEL } from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import { samples } from '@/samples/registry'
import { useServicesInUse } from '@/services/_generated/in-use'
import { hasExecutionMode } from '@/services/execution'
import {
  buildPaletteItems,
  type PaletteItem,
  type PaletteItemKind,
} from './palette-items'

const MAX_RESULTS = 12

const OPEN_EVENT = 'edge-ai-studio:open-palette'

const KIND_LABEL: Record<PaletteItemKind, string> = {
  service: 'Service',
  instance: 'Instance',
  sample: 'Sample',
  action: 'Action',
  page: 'Page',
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const at = text.toLowerCase().indexOf(query.toLowerCase())
  if (at === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-primary/20 text-foreground rounded-[2px] px-0.5">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  )
}

/**
 * Reaches every service and instance, including ones never added (opening one doesn't add it).
 * Combobox over a listbox: focus stays in the input; arrows move `aria-activedescendant`.
 */
export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const optionId = (index: number) => `${listId}-option-${index}`

  const { services, serviceInfoMap, serviceById, startService, stopService } =
    useServiceStatus()
  const { recent, noteVisit } = useServiceShortcuts()
  const inUse = useServicesInUse()
  const { guard, dialog: interruptionDialog } = useInterruptionGuard()

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    const onOpenRequest = () => setOpen(true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener(OPEN_EVENT, onOpenRequest)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(OPEN_EVENT, onOpenRequest)
    }
  }, [])

  const results = buildPaletteItems({
    query,
    services: services.filter((s) => !s.hidden),
    recent,
    inUse,
    samples,
    pages: APP_PAGES,
    canToggle: (s) =>
      !hasExecutionMode(s.execution, 'none') &&
      resolveServiceInfo(serviceInfoMap, s.id) !== undefined,
  }).slice(0, MAX_RESULTS)
  const hiddenCount = results.filter((r) => r.notInSidebar).length
  const active = results.at(cursor)

  const closePalette = () => {
    setOpen(false)
    setQuery('')
    setCursor(0)
  }

  const choose = ({ action }: PaletteItem) => {
    if (action.type === 'go') {
      const { href, visit } = action
      navigateWithLeaveGuard(() => {
        if (visit) noteVisit(visit)
        router.push(href)
      })
    } else if (action.type === 'stop') {
      // A stop by type reaches the type's primary instance.
      const target = serviceById.get(action.serviceId)
      const targets = target?.instanceKey
        ? [
            {
              instanceKey: target.instanceKey,
              label: target.label ?? target.name,
            },
          ]
        : []
      // A failure is reported as a toast by the service status context.
      guard(targets, 'stop', () => {
        stopService(action.serviceId).catch(() => {})
      })
    } else {
      startService(action.serviceId).catch(() => {})
    }
    closePalette()
  }

  const onOpenChange = (next: boolean) => {
    if (next) setOpen(true)
    else closePalette()
  }

  const onQueryChange = (next: string) => {
    setQuery(next)
    setCursor(0)
  }

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor, query])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((c) => (results.length ? (c + 1) % results.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((c) =>
        results.length ? (c - 1 + results.length) % results.length : 0,
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (active) choose(active)
    }
  }

  const trimmed = query.trim()

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="top-[12%] max-w-2xl translate-y-0 gap-0 overflow-hidden p-0"
        >
          <DialogTitle className="sr-only">
            Search services, instances, samples and actions
          </DialogTitle>

          <div className="border-border flex h-12 items-center gap-3 border-b px-4">
            <Search
              aria-hidden="true"
              className="text-muted-foreground h-4 w-4 shrink-0"
            />
            <input
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active ? optionId(cursor) : undefined}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search services, instances, samples and actions"
              aria-label="Search services, instances, samples and actions"
              className="placeholder:text-muted-foreground h-full flex-1 bg-transparent text-[15px] outline-none"
            />
            <kbd className="text-muted-foreground border-border bg-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">
              esc
            </kbd>
          </div>

          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Results"
            className="max-h-[min(60vh,420px)] overflow-y-auto py-1.5"
          >
            {results.map((item, index) => (
              <div
                key={item.key}
                id={optionId(index)}
                role="option"
                aria-selected={index === cursor}
                onMouseMove={() => setCursor(index)}
                onClick={() => choose(item)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm',
                  index === cursor
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground',
                )}
              >
                <span
                  aria-hidden="true"
                  className="text-muted-foreground shrink-0"
                >
                  <item.icon className="h-4 w-4" />
                </span>
                <span className="shrink-0 font-medium">
                  <Highlight text={item.label} query={trimmed} />
                </span>
                {item.sublabel && (
                  <span
                    className={cn(
                      'truncate text-xs',
                      index === cursor
                        ? 'text-accent-foreground/80'
                        : 'text-muted-foreground',
                    )}
                  >
                    {item.sublabel}
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  {item.status && (
                    <>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'h-1.5 w-1.5',
                          shapedStatusDotClass(item.status),
                        )}
                      />
                      <span className="sr-only">
                        , {item.statusLabel ?? STATE_LABEL[item.status]}
                      </span>
                    </>
                  )}
                  <span className="text-muted-foreground border-border rounded border px-1.5 py-0.5 text-xs font-medium">
                    {KIND_LABEL[item.kind]}
                  </span>
                </span>
              </div>
            ))}
          </div>
          {results.length === 0 && (
            <p className="text-muted-foreground px-4 pb-8 text-center text-sm">
              Nothing matches “{query}”.
            </p>
          )}

          <div className="border-border bg-muted/40 text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-xs">
            <span className="flex items-center gap-1.5">
              <CornerDownLeft aria-hidden="true" className="h-3 w-3" /> open
            </span>
            <span>↑ ↓ navigate</span>
            <span className="ml-auto" role="status">
              {hiddenCount > 0
                ? `${results.length} results · ${hiddenCount} not added`
                : trimmed
                  ? `${results.length} results`
                  : 'Searching all services and instances'}
            </span>
          </div>
        </DialogContent>
      </Dialog>
      {interruptionDialog}
    </>
  )
}

/** Opens the palette from anywhere without threading state through the tree. */
export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_EVENT))
}
