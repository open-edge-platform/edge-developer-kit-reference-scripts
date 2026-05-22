// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FileText, Play, Terminal } from 'lucide-react'
import { useMemo, useSyncExternalStore } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useGetService } from '@/context/service-status-context'
import { docsRegistry } from '@/services/_generated/docs'
import { ServiceDemo } from '@/services/common/demo/components/service-demo'
import { ServiceDocs } from '@/services/common/documentation/components/doc'
import { ServiceLogs } from '@/services/common/logs/components/log'

const emptySubscribe = () => () => {}

export function ServiceDetailTabs({ serviceId }: { serviceId: string }) {
  const service = useGetService(serviceId)

  const host = useSyncExternalStore(
    emptySubscribe,
    () => window.location.host,
    () => '',
  )

  const docs = useMemo(
    () =>
      service && host
        ? (docsRegistry[service.id]?.({
            host: `${host}/${service.id}`,
          }) ?? null)
        : null,
    [service, host],
  )

  if (!service) return null

  return (
    <Tabs defaultValue="demo" className="w-full">
      <TabsList
        variant="line"
        className="border-border h-auto w-full justify-start gap-0 rounded-none border-b px-0 pb-0"
      >
        <TabsTrigger
          value="demo"
          className="data-[state=active]:border-b-primary data-[state=active]:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground gap-2 rounded-none border-b-2 border-transparent px-4 pt-1 pb-3 text-sm font-medium transition-colors after:hidden data-[state=active]:border-transparent data-[state=active]:bg-transparent"
        >
          <Play className="h-3.5 w-3.5" />
          Demo
        </TabsTrigger>
        <TabsTrigger
          value="docs"
          className="data-[state=active]:border-b-primary data-[state=active]:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground gap-2 rounded-none border-b-2 border-transparent px-4 pt-1 pb-3 text-sm font-medium transition-colors after:hidden data-[state=active]:border-transparent data-[state=active]:bg-transparent"
        >
          <FileText className="h-3.5 w-3.5" />
          Documentation
        </TabsTrigger>
        {service.logSources.length > 0 && (
          <TabsTrigger
            value="logs"
            className="data-[state=active]:border-b-primary data-[state=active]:text-primary data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground gap-2 rounded-none border-b-2 border-transparent px-4 pt-1 pb-3 text-sm font-medium transition-colors after:hidden data-[state=active]:border-transparent data-[state=active]:bg-transparent"
          >
            <Terminal className="h-3.5 w-3.5" />
            Logs
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent
        value="demo"
        forceMount
        className="section-fade mt-6 data-[state=inactive]:hidden"
      >
        <ServiceDemo service={service} />
      </TabsContent>

      <TabsContent
        value="docs"
        forceMount
        className="section-fade mt-6 data-[state=inactive]:hidden"
      >
        {docs ? <ServiceDocs service={service} docs={docs} /> : null}
      </TabsContent>
      {service.logSources.length > 0 && (
        <TabsContent
          value="logs"
          forceMount
          className="section-fade mt-6 data-[state=inactive]:hidden"
        >
          <ServiceLogs service={service} logSources={service.logSources} />
        </TabsContent>
      )}
    </Tabs>
  )
}
