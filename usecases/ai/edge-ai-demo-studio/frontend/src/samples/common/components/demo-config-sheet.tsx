// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, ArrowRight, Settings2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Switch } from '@/components/ui/switch'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { DemoParam } from '@/types/demo-params'
import { ParamRenderer } from './param-renderer'

export type { ParamSlider, ParamSelect, DemoParam } from '@/types/demo-params'

/** A group of params tied to a specific service */
export interface ServiceParamGroup {
  /** Service display name, e.g. "Text Generation" */
  serviceLabel: string
  /** Service id (used to look up status) */
  serviceId: string
  /** Whether the service is currently online */
  online: boolean
  /** Whether this service is optional for the sample */
  optional: boolean
  /** Message to show when the service is offline */
  offlineMessage?: string
  /** Link to navigate to for turning the service on */
  configHref?: string
  /** The params belonging to this service */
  params: DemoParam[]
  /** Whether this optional service is currently enabled (toggled on) */
  enabled?: boolean
  /** Callback to toggle this optional service on/off */
  onToggle?: (enabled: boolean) => void
  /** Extra content rendered below the params inside the accordion */
  children?: ReactNode
}

interface DemoConfigSheetProps {
  groups: ServiceParamGroup[]
  /** Extra content at the bottom of the sheet */
  children?: ReactNode
}

export function DemoConfigSheet({ groups, children }: DemoConfigSheetProps) {
  // Open the first required (online) group by default
  const defaultOpen =
    groups.find((g) => !g.optional && g.online)?.serviceId ??
    groups[0]?.serviceId ??
    ''

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 text-xs">
          <Settings2 className="h-3.5 w-3.5" />
          Configure
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[340px] overflow-y-auto sm:max-w-[340px]"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <div className="bg-primary/10 flex h-7 w-7 items-center justify-center rounded-lg">
              <Settings2 className="text-primary h-4 w-4" />
            </div>
            Demo Configuration
          </SheetTitle>
          <SheetDescription>
            Configure parameters for each service used in this demo.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 px-4 pb-6">
          <Accordion
            type="multiple"
            defaultValue={[defaultOpen]}
            className="w-full"
          >
            {groups.map((group) => (
              <AccordionItem
                key={group.serviceId}
                value={group.serviceId}
                className="border-border"
              >
                <div className="flex items-center gap-2">
                  <AccordionTrigger className="flex-1 py-3 hover:no-underline">
                    <div className="flex w-full items-center gap-2">
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          group.online
                            ? 'bg-success'
                            : 'bg-muted-foreground/40',
                        )}
                      />
                      <span className="text-foreground text-sm font-medium">
                        {group.serviceLabel}
                      </span>
                      {group.optional && group.online && (
                        <span className="text-muted-foreground border-border rounded border px-1.5 py-0.5 text-[10px]">
                          Optional
                        </span>
                      )}
                    </div>
                  </AccordionTrigger>
                  {group.optional && group.onToggle != null && (
                    <Switch
                      size="sm"
                      checked={group.online && (group.enabled ?? false)}
                      disabled={!group.online}
                      onCheckedChange={group.onToggle}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0"
                    />
                  )}
                </div>
                <AccordionContent>
                  {!group.online ? (
                    <div className="border-warning/20 bg-warning/5 mb-3 space-y-3 rounded-lg border p-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="text-warning mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <p className="text-warning text-xs font-medium">
                            {group.serviceLabel} is offline
                          </p>
                          <p className="text-warning/70 mt-0.5 text-[11px]">
                            {group.offlineMessage ??
                              'This service needs to be running to configure these parameters.'}
                          </p>
                        </div>
                      </div>
                      {group.configHref && (
                        <a href={group.configHref}>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-warning/20 text-warning/80 hover:bg-warning/10 hover:text-warning w-full gap-2 text-xs"
                          >
                            Go to Configuration
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        </a>
                      )}

                      {/* Grayed-out params preview */}
                      <div className="pointer-events-none space-y-3 opacity-30 select-none">
                        {group.params.map((param) => (
                          <ParamRenderer key={param.id} param={param} />
                        ))}
                      </div>
                    </div>
                  ) : group.params.length > 0 || group.children ? (
                    <div className="space-y-4 pb-2">
                      {group.params.map((param) => (
                        <ParamRenderer key={param.id} param={param} />
                      ))}
                      {group.children}
                    </div>
                  ) : (
                    <p className="text-muted-foreground pb-2 text-xs">
                      No configurable parameters. Use the toggle to enable or
                      disable this service.
                    </p>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
