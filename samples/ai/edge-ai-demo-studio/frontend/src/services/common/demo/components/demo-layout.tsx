// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { SlidersHorizontal } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'
import { ParameterPlacementContext } from './parameter-placement'

/** Wide enough (Tailwind `xl`) for the parameters beside the demo. */
const WIDE_QUERY = '(min-width: 80rem)'

/**
 * Layout of a demo with parameters: from `xl` up a fixed-width parameter column beside it; below, a
 * Parameters button that opens them in a sheet, so nobody scrolls past results to reach them.
 */
export function DemoLayout({
  children,
  sidebar,
  className,
  parametersLabel = 'Parameters',
  customCount = 0,
  toolbar,
}: {
  children: ReactNode
  /** The parameter column; nothing beside the demo when omitted. */
  sidebar?: ReactNode
  className?: string
  /** Names the button and the sheet below `xl` (default "Parameters"). */
  parametersLabel?: string
  /** How many parameters differ from their defaults, shown on the button. */
  customCount?: number
  /** Controls (e.g. a mode switch) leading the Parameters button's row, kept at every width. */
  toolbar?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const isWide = useMediaQuery(WIDE_QUERY)
  // The sheet only exists below `xl`; widening the window closes it for
  // good (narrowing again does not reopen it) and brings the column back.
  if (open && isWide) setOpen(false)
  const sheetOpen = open && !isWide && Boolean(sidebar)

  return (
    // The sheet's root renders nothing: it wraps the layout so the button
    // is its trigger, which gets focus back when the sheet closes.
    <Sheet open={sheetOpen} onOpenChange={setOpen}>
      <div className={cn('flex flex-col gap-6 xl:flex-row', className)}>
        <div className="min-w-0 flex-1 space-y-6">
          {(sidebar || toolbar) && (
            <div
              className={cn(
                'flex flex-wrap items-center justify-end gap-2',
                !toolbar && 'xl:hidden',
              )}
            >
              {toolbar && <div className="mr-auto min-w-0">{toolbar}</div>}
              {sidebar && (
                <SheetTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="xl:hidden"
                    data-testid="demo-parameters-button"
                  >
                    <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
                    {parametersLabel}
                    {customCount > 0 && (
                      <Badge tone="primary" className="h-5 min-w-5 px-1.5">
                        {customCount}
                        <span className="sr-only"> changed</span>
                      </Badge>
                    )}
                  </Button>
                </SheetTrigger>
              )}
            </div>
          )}
          {children}
        </div>

        {/* Unmounted while the sheet is open (no duplicate ids); hidden, not unmounted, below
          `xl` so the first paint needs no media query. */}
        {sidebar && !sheetOpen && (
          <div
            className="hidden shrink-0 space-y-4 xl:block xl:w-72"
            data-testid="demo-parameters-column"
          >
            {sidebar}
          </div>
        )}

        {sidebar && (
          <SheetContent
            aria-describedby={undefined}
            // Focus the sheet rather than its first control, which would
            // open that control's tooltip over the title.
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              if (event.currentTarget instanceof HTMLElement)
                event.currentTarget.focus()
            }}
            data-testid="demo-parameters-sheet"
          >
            <SheetHeader className="pr-12 pb-0">
              <SheetTitle>{parametersLabel}</SheetTitle>
            </SheetHeader>
            <ParameterPlacementContext.Provider value="sheet">
              <div className="space-y-4 px-4 pb-6">{sidebar}</div>
            </ParameterPlacementContext.Provider>
          </SheetContent>
        )}
      </div>
    </Sheet>
  )
}
