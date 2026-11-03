// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { shapedStatusDotClass } from '@/components/common/tones'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { STATE_LABEL } from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import { ServiceLogs } from '@/services/common/logs/components/log'
import type { Service } from '@/services/types'

interface ServiceLogTabsProps {
  services: Service[]
  /** Selected `Service.id`; controlled when set, else the first service and uncontrolled. */
  value?: string
  onValueChange?: (value: string) => void
  orientation?: 'horizontal' | 'vertical'
  /** Extra classes on the border wrapping the tab list. */
  listContainerClassName?: string
  listClassName?: string
  /** Extra classes on each `TabsContent`. */
  contentClassName?: string
  /** When set, wraps each `ServiceLogs` panel in a div with this className. */
  contentWrapperClassName?: string
}

/** One `<ServiceLogs compact>` tab per service, with the service's state in each trigger. */
export function ServiceLogTabs({
  services,
  value,
  onValueChange,
  orientation,
  listContainerClassName,
  listClassName,
  contentClassName,
  contentWrapperClassName,
}: ServiceLogTabsProps) {
  if (services.length === 0) return null

  return (
    <Tabs
      value={value}
      defaultValue={value === undefined ? services[0].id : undefined}
      onValueChange={onValueChange}
      className="gap-0"
      orientation={orientation}
    >
      <div className={cn('border-border border-b', listContainerClassName)}>
        <TabsList variant="line" className={cn('h-9 gap-0', listClassName)}>
          {services.map((s) => (
            <TabsTrigger
              key={s.id}
              value={s.id}
              className="gap-1.5 px-3 text-xs"
            >
              <span
                className={cn(
                  'h-2 w-2 shrink-0',
                  shapedStatusDotClass(s.status),
                )}
                aria-hidden
              />
              {s.name}
              <span className="sr-only">, {STATE_LABEL[s.status]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {services.map((s) => (
        <TabsContent
          key={s.id}
          value={s.id}
          forceMount
          className={cn('data-[state=inactive]:hidden', contentClassName)}
        >
          {contentWrapperClassName ? (
            <div className={contentWrapperClassName}>
              <ServiceLogs service={s} compact />
            </div>
          ) : (
            <ServiceLogs service={s} compact />
          )}
        </TabsContent>
      ))}
    </Tabs>
  )
}
