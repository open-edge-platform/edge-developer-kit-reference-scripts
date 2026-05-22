// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ScrollText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { ServiceLogs } from '@/services/common/logs/components/log'
import type { Service } from '@/services/types'

export function SampleLogDrawer({
  services,
  onClose,
}: {
  services: Service[]
  onClose: () => void
}) {
  if (services.length === 0) return null

  const defaultTab = services[0].id

  return (
    <div
      id="sample-log-drawer"
      className="glass-card animate-in slide-in-from-bottom-2 fade-in-0 overflow-hidden rounded-xl duration-200"
    >
      <div className="border-border flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ScrollText className="text-muted-foreground h-4 w-4" />
          <h2 className="text-foreground text-sm font-semibold">
            Service Logs
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="Close log drawer"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Tabs defaultValue={defaultTab} className="gap-0">
        <div className="border-border border-b px-4">
          <TabsList variant="line" className="h-9 gap-0">
            {services.map((s) => (
              <TabsTrigger
                key={s.id}
                value={s.id}
                className="gap-1.5 px-3 text-xs"
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    s.status === 'online' && 'bg-success',
                    s.status === 'starting' && 'bg-warning animate-pulse',
                    s.status === 'error' && 'bg-red-500',
                    s.status !== 'online' &&
                      s.status !== 'starting' &&
                      s.status !== 'error' &&
                      'bg-muted-foreground/40',
                  )}
                />
                {s.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {services.map((s) => (
          <TabsContent
            key={s.id}
            value={s.id}
            forceMount
            className="data-[state=inactive]:hidden"
          >
            <div className="p-4">
              <ServiceLogs service={s} logSources={s.logSources} compact />
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
