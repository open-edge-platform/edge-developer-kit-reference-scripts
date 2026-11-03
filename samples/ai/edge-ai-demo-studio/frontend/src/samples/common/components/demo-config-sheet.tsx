// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, ArrowRight, Settings2 } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Badge } from '@/components/ui/badge'
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { ServiceParamGroup } from '@/types/demo-params'
import { ParamRenderer } from '@/components/common/param-renderer'
import { SampleInstancePicker } from '@/components/samples/sample-instance-picker'
import { getServiceById } from '@/services/registry'

/** Wording and test ids of the sheet's chrome, for samples whose tests name them. */
export interface DemoConfigSheetChrome {
  triggerLabel?: string
  triggerTestId?: string
  title?: string
  titleTestId?: string
  description?: string
}

interface DemoConfigSheetProps {
  groups: ServiceParamGroup[]
  children?: ReactNode
  footer?: ReactNode
  chrome?: DemoConfigSheetChrome
}

/** Per-service task parameters; instances and runtime settings live under the toolbar's Services. */
export function DemoConfigSheet({
  groups,
  children,
  footer,
  chrome,
}: DemoConfigSheetProps) {
  const defaultOpen =
    groups.find((g) => !g.optional && g.online)?.serviceId ??
    groups[0]?.serviceId ??
    ''

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          data-testid={chrome?.triggerTestId}
        >
          <Settings2 className="h-3.5 w-3.5" aria-hidden />
          {chrome?.triggerLabel ?? 'Parameters'}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full max-w-[100vw] overflow-y-auto data-[state=closed]:duration-150 data-[state=open]:duration-200 sm:w-[360px] sm:max-w-[360px]"
      >
        <SheetHeader>
          <SheetTitle
            className="flex items-center gap-2 text-base"
            data-testid={chrome?.titleTestId}
          >
            <div
              className="bg-primary/10 flex h-7 w-7 items-center justify-center rounded-lg"
              aria-hidden
            >
              <Settings2 className="text-primary h-4 w-4" aria-hidden />
            </div>
            {chrome?.title ?? 'Parameters'}
          </SheetTitle>
          <SheetDescription>
            {chrome?.description ??
              'Settings for this task, per service. Instances and runtime settings are under Services.'}
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
                        aria-hidden
                      />
                      <span className="text-foreground text-sm font-medium">
                        {group.serviceLabel}
                        <span className="sr-only">
                          {group.online ? ' (online)' : ' (offline)'}
                        </span>
                      </span>
                      {group.optional && group.online && (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground rounded px-1.5 text-[10px] font-normal"
                        >
                          Optional
                        </Badge>
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
                      aria-label={`Use ${group.serviceLabel}`}
                    />
                  )}
                </div>
                <AccordionContent>
                  <SampleInstanceRows group={group} />
                  {!group.online ? (
                    <div className="mb-3 space-y-3">
                      <InlineNotice
                        tone="warning"
                        role="note"
                        icon={
                          <AlertCircle
                            className="text-warning h-4 w-4 shrink-0 self-start"
                            aria-hidden
                          />
                        }
                      >
                        <span className="block text-xs font-medium">
                          {group.serviceLabel} is offline
                        </span>
                        {group.offlineMessage ??
                          'This service needs to be running to configure these parameters.'}
                      </InlineNotice>
                      {group.configHref && (
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="w-full gap-2 text-xs"
                        >
                          <Link href={group.configHref}>
                            Go to Configuration
                            <ArrowRight className="h-3 w-3" aria-hidden />
                          </Link>
                        </Button>
                      )}

                      {/* What the settings will be, greyed out and out of
                          the tab order until the service runs. */}
                      <div inert className="space-y-3 opacity-30 select-none">
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
        {footer && (
          <SheetFooter className="flex-row justify-end">{footer}</SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** An instance picker per service type in `group`; each renders only for a type with several. */
function SampleInstanceRows({ group }: { group: ServiceParamGroup }) {
  const types = group.instanceTypes ?? [group.serviceId]
  return (
    <>
      {types.map((type) => (
        <SampleInstancePicker
          key={type}
          serviceType={type}
          label={
            types.length > 1
              ? `${getServiceById(type)?.name ?? type} instance`
              : 'Instance'
          }
          className="mb-3"
        />
      ))}
    </>
  )
}
