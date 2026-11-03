// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronDown, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { plural } from '@/lib/browser/format'
import { cn } from '@/lib/utils'
import type { SampleReadinessView } from '@/samples/common/readiness'
import { hasRecommendedConfig, type Sample } from '@/samples/types'
import { SampleServiceRow } from './sample-service-row'
import { StartAllServicesButton } from './start-all-services-button'

/** The folded part of "Prepare this sample": required services, settings, optional features. */
export function SampleSetupChecklist({
  sample,
  view,
  onUseRecommendedConfig,
}: {
  sample: Sample
  view: SampleReadinessView
  onUseRecommendedConfig: () => void
}) {
  return (
    <div className="border-border border-t">
      {view.state === 'checking' ? (
        <ol className="divide-border divide-y" aria-busy="true">
          {view.required.map((d) => (
            <li key={d.serviceId} className="flex items-center gap-3 px-5 py-3">
              <span className="bg-muted h-8 w-8 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <p className="text-foreground text-sm font-medium">{d.name}</p>
                <span className="shimmer block h-3 w-24 rounded" />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="divide-border divide-y">
          {view.required.map((d) => (
            <SampleServiceRow key={d.serviceId} dependency={d} />
          ))}
        </ol>
      )}

      {hasRecommendedConfig(sample) && (
        <div className="border-border flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-5 py-3">
          <Button
            variant="link"
            size="sm"
            className="text-primary ml-auto gap-1.5 px-0"
            onClick={onUseRecommendedConfig}
          >
            <Wand2 className="h-3.5 w-3.5" aria-hidden />
            Review recommended settings
          </Button>
        </div>
      )}

      {view.optional.length > 0 && <OptionalFeatures view={view} />}
    </div>
  )
}

/**
 * Optional services, folded by default. Rows stay mounted while folded, so an open configure sheet
 * or a pending action inside survives folding.
 */
function OptionalFeatures({ view }: { view: SampleReadinessView }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-border border-t"
    >
      <CollapsibleTrigger className="hover:bg-muted/40 flex w-full items-center gap-2 px-5 py-3 text-left transition-colors">
        <span className="text-foreground text-sm font-medium">
          Optional features
        </span>
        <span className="text-muted-foreground text-xs">
          {view.optionalReady} of {plural(view.optionalTotal, 'service')}{' '}
          running
          {view.optionalOffline.length > 0 &&
            ' · the sample still works without them'}
        </span>
        <ChevronDown
          className={cn(
            'text-muted-foreground ml-auto h-4 w-4 shrink-0 transition-transform duration-200',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent forceMount hidden={!open}>
        <ol className="divide-border border-border divide-y border-t">
          {view.optional.map((d) => (
            <SampleServiceRow key={d.serviceId} dependency={d} />
          ))}
        </ol>
        {view.settled && view.optionalOffline.length > 0 && (
          <div className="border-border border-t px-5 py-3">
            <StartAllServicesButton
              dependencies={view.optional}
              label="Start optional services"
              busyLabel="Starting optional services…"
            />
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
