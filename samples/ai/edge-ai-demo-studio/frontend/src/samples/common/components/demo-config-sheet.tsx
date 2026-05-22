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
import { ParamRenderer } from '@/components/common/param-renderer'

export type { ParamSlider, ParamSelect, DemoParam } from '@/types/demo-params'

export interface ServiceParamGroup {
  serviceLabel: string
  serviceId: string
  online: boolean
  optional: boolean
  offlineMessage?: string
  configHref?: string
  params: DemoParam[]
  enabled?: boolean
  onToggle?: (enabled: boolean) => void
  children?: ReactNode
}

interface DemoConfigSheetProps {
  groups: ServiceParamGroup[]
  children?: ReactNode
}

export function DemoConfigSheet({ groups, children }: DemoConfigSheetProps) {
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
