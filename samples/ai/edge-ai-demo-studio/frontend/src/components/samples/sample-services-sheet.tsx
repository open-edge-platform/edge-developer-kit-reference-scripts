// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Server, Settings } from 'lucide-react'
import Link from 'next/link'
import type { RefObject } from 'react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useReturnFocus } from '@/hooks/use-return-focus'
import {
  requiredSummary,
  type SampleReadinessView,
} from '@/samples/common/readiness'
import type { Sample } from '@/samples/types'
import { ReadinessSummary } from './readiness-summary'
import { SampleServiceRow } from './sample-service-row'
import { StartAllServicesButton } from './start-all-services-button'

interface SampleServicesSheetProps {
  sample: Sample
  view: SampleReadinessView
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Takes focus on close when the button that opened the sheet is gone. */
  fallbackFocus?: RefObject<HTMLElement | null>
}

/** The demo toolbar's Services sheet: each dependency's instance and state, as on the setup page. */
export function SampleServicesSheet({
  sample,
  view,
  open,
  onOpenChange,
  fallbackFocus,
}: SampleServicesSheetProps) {
  const returnFocus = useReturnFocus(open, fallbackFocus)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-[100vw] gap-0 overflow-y-auto p-0 data-[state=closed]:duration-150 data-[state=open]:duration-200 sm:w-[420px] sm:max-w-[420px]"
        onCloseAutoFocus={returnFocus}
      >
        <SheetHeader className="border-border border-b">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="bg-primary/10 flex h-7 w-7 items-center justify-center rounded-lg">
              <Server className="text-primary h-4 w-4" aria-hidden />
            </span>
            Services
          </SheetTitle>
          <SheetDescription>
            The instances this demo talks to and their runtime state.{' '}
            {view.settled && requiredSummary(view)}.
          </SheetDescription>
          <ReadinessSummary view={view} variant="pill" className="mt-1 w-fit" />
        </SheetHeader>

        <p className="text-muted-foreground px-4 pt-4 pb-1 text-xs font-semibold tracking-wider uppercase">
          Required
        </p>
        <ol className="divide-border min-w-0 divide-y">
          {view.required.map((d) => (
            <SampleServiceRow
              key={d.serviceId}
              dependency={d}
              className="px-4"
            />
          ))}
        </ol>

        {view.optional.length > 0 && (
          <>
            <p className="text-muted-foreground border-border border-t px-4 pt-4 pb-1 text-xs font-semibold tracking-wider uppercase">
              Optional
            </p>
            <ol className="divide-border min-w-0 divide-y">
              {view.optional.map((d) => (
                <SampleServiceRow
                  key={d.serviceId}
                  dependency={d}
                  className="px-4"
                />
              ))}
            </ol>
          </>
        )}

        <div className="border-border mt-auto flex flex-wrap items-center gap-2 border-t p-4">
          {view.settled && !view.allRequiredOnline && (
            <StartAllServicesButton dependencies={view.required} />
          )}
          <Button
            asChild
            variant="outline"
            size="sm"
            className="ml-auto gap-1.5"
          >
            <Link href={`/samples/${sample.id}`}>
              <Settings className="h-3.5 w-3.5" aria-hidden />
              Open setup page
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
