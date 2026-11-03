// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ApiEndpoint } from '@/services/types'
import {
  BackendBadge,
  type BackendContext,
  servedByActive,
} from './backend-badge'
import { ParamsTable } from './params-table'

const methodColor: Record<string, string> = {
  GET: 'bg-success/10 text-success border-success/20',
  POST: 'bg-primary/10 text-primary border-primary/20',
  PUT: 'bg-warning/10 text-warning border-warning/20',
  DELETE: 'bg-destructive/10 text-destructive border-destructive/20',
  PATCH: 'bg-info/10 text-info border-info/20',
}

/**
 * One endpoint in the docs' accordion, opening to its parameters. One the selected instance does
 * not serve gets a dashed outline.
 */
export function EndpointItem({
  value,
  endpoint,
  backends,
}: {
  value: string
  endpoint: ApiEndpoint
  backends: BackendContext
}) {
  const served = servedByActive(endpoint.backends, backends)
  return (
    <AccordionItem
      value={value}
      className={cn(
        'border-border data-[state=open]:border-primary/30 overflow-hidden rounded-xl border last:border-b',
        served === false && 'bg-muted/20 border-dashed',
      )}
      data-testid="docs-endpoint"
      data-served={served === undefined ? undefined : String(served)}
    >
      <AccordionTrigger className="hover:bg-muted/30 items-center gap-3 px-4 py-4 hover:no-underline">
        <div className="min-w-0 flex-1 space-y-2 text-left">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
            <Badge
              variant="outline"
              className={cn(
                'min-w-16 shrink-0 justify-center font-mono text-xs',
                methodColor[endpoint.method] ?? methodColor.GET,
              )}
            >
              {endpoint.method}
            </Badge>
            <code className="min-w-0 flex-1 basis-40 font-mono text-xs leading-5 [overflow-wrap:anywhere] sm:text-sm">
              {endpoint.path}
            </code>
            <BackendBadge ids={endpoint.backends} context={backends} />
          </div>
          <p className="text-muted-foreground line-clamp-2 text-xs leading-5 font-normal">
            {endpoint.description}
          </p>
        </div>
      </AccordionTrigger>
      <AccordionContent className="border-border border-t px-4 pt-4 pb-4">
        <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
          {endpoint.description}
        </p>
        {endpoint.params?.length ? (
          <ParamsTable params={endpoint.params} backends={backends} />
        ) : (
          <p className="text-muted-foreground text-xs">No parameters listed.</p>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}
