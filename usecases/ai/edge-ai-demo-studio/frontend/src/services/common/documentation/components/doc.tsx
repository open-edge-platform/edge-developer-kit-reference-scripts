// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type {
  ApiEndpoint,
  ApiParam,
  CodeSample,
  Service,
  ServiceDocsData,
} from '@/services/types'
import CodeBlock from './codeblock'
import { DocsNavigation, type NavItem } from './docs-navigation'

const methodColor: Record<string, string> = {
  GET: 'bg-success/15 text-success border-success/20',
  POST: 'bg-primary/15 text-primary border-primary/20',
  PUT: 'bg-warning/15 text-warning border-warning/20',
  DELETE: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20',
  PATCH:
    'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20',
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string
  title: string
  description?: string
}) {
  return (
    <div className="space-y-2">
      {eyebrow ? (
        <p className="text-primary text-xs font-semibold tracking-[0.12em] uppercase">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-foreground text-2xl font-semibold">{title}</h2>
      {description ? (
        <p className="text-muted-foreground text-sm leading-relaxed">
          {description}
        </p>
      ) : null}
    </div>
  )
}

function OverviewSection({
  serviceName,
  description,
}: {
  serviceName: string
  description?: string
}) {
  if (!description) return null

  return (
    <section id="about" className="scroll-mt-28 space-y-2">
      <SectionHeader
        eyebrow="Overview"
        title={`About ${serviceName}`}
        description={description}
      />
    </section>
  )
}

function ApiOverviewSection({ overview }: { overview: string }) {
  return (
    <section id="api-overview" className="scroll-mt-28 space-y-3">
      <SectionHeader
        eyebrow="Documentation"
        title="API overview"
        description={overview}
      />
    </section>
  )
}

function ParamsTable({ params }: { params: ApiParam[] }) {
  if (!params.length) return null

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
        Parameters
      </p>
      <div className="border-border overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border bg-muted/30 border-b">
              <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
                Name
              </th>
              <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
                Type
              </th>
              <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
                Required
              </th>
              <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
                Description
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {params.map((param) => (
              <tr key={param.name}>
                <td className="px-3 py-2">
                  <code className="text-secondary font-mono text-xs">
                    {param.name}
                  </code>
                </td>
                <td className="text-muted-foreground px-3 py-2 text-xs">
                  {param.type}
                </td>
                <td className="px-3 py-2">
                  {param.required ? (
                    <Badge
                      variant="secondary"
                      className="bg-primary/10 text-primary text-[10px]"
                    >
                      Required
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      Optional
                    </span>
                  )}
                </td>
                <td className="text-muted-foreground px-3 py-2 text-xs">
                  {param.desc}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EndpointItem({
  endpoint,
  index,
}: {
  endpoint: ApiEndpoint
  index: number
}) {
  return (
    <AccordionItem
      value={`ep-${index}`}
      className="border-border bg-card rounded-xl border"
    >
      <AccordionTrigger className="px-5 py-4 hover:no-underline">
        <div className="flex items-center gap-3">
          <Badge
            className={cn(
              'min-w-[52px] shrink-0 justify-center font-mono text-[11px]',
              methodColor[endpoint.method] ?? methodColor.GET,
            )}
            variant="outline"
          >
            {endpoint.method}
          </Badge>
          <code className="text-foreground text-left font-mono text-sm">
            {endpoint.path}
          </code>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-5 pb-5">
        <p className="text-muted-foreground mb-4 text-sm">
          {endpoint.description}
        </p>
        {endpoint.params ? <ParamsTable params={endpoint.params} /> : null}
      </AccordionContent>
    </AccordionItem>
  )
}

function EndpointsSection({ endpoints }: { endpoints: ApiEndpoint[] }) {
  if (!endpoints.length) return null

  return (
    <section id="endpoints" className="scroll-mt-28 space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-foreground text-2xl font-semibold">Endpoints</h2>
        <Badge variant="secondary" className="text-xs">
          {endpoints.length} endpoints
        </Badge>
      </div>
      <Accordion type="multiple" className="space-y-2">
        {endpoints.map((endpoint, idx) => (
          <EndpointItem
            key={`${endpoint.method}-${endpoint.path}`}
            endpoint={endpoint}
            index={idx}
          />
        ))}
      </Accordion>
    </section>
  )
}

function ResponseSection({ responseExample }: { responseExample: string }) {
  return (
    <section id="response" className="scroll-mt-28 space-y-3">
      <h2 className="text-foreground text-2xl font-semibold">
        Response example
      </h2>
      <div className="relative">
        <pre className="border-border bg-muted/20 text-muted-foreground overflow-x-auto rounded-xl border p-4 font-mono text-xs leading-relaxed">
          {responseExample}
        </pre>
      </div>
    </section>
  )
}

function SamplesSection({
  intro,
  samples,
}: {
  intro?: string
  samples: CodeSample[]
}) {
  if (!samples.length) return null

  return (
    <section id="samples" className="scroll-mt-28 space-y-3">
      <h2 className="text-foreground text-2xl font-semibold">Sample code</h2>
      {intro ? (
        <p className="text-muted-foreground text-sm leading-relaxed">{intro}</p>
      ) : null}
      <div className="space-y-4">
        {samples.map((sample) => (
          <CodeBlock
            key={sample.title}
            title={sample.title}
            data={sample.codeSnippets}
          />
        ))}
      </div>
    </section>
  )
}

function buildNavItems(docs: ServiceDocsData, serviceName: string): NavItem[] {
  const items: NavItem[] = [
    docs.serviceDescription
      ? {
          id: 'about',
          title: `About ${serviceName}`,
          description: 'What the service is best at and when to use it.',
        }
      : null,
    {
      id: 'api-overview',
      title: 'API overview',
      description: 'Base URL, capabilities, and what the endpoint returns.',
    },
    docs.endpoints?.length
      ? {
          id: 'endpoints',
          title: 'Endpoints',
          description: `${docs.endpoints.length} routes with parameters and usage notes.`,
        }
      : null,
    {
      id: 'response',
      title: 'Response format',
      description: 'Shape of the JSON payload with a real example.',
    },
    docs.sampleCode?.length
      ? {
          id: 'samples',
          title: 'Sample code',
          description:
            'Copy-ready snippets for quick starts in multiple languages.',
        }
      : null,
  ].filter(Boolean) as NavItem[]

  return items
}

export function ServiceDocs({
  service,
  docs,
}: {
  service: Service
  docs: ServiceDocsData
}) {
  const navItems = useMemo(
    () => buildNavItems(docs, service.name),
    [docs, service.name],
  )
  const [activeId, setActiveId] = useState(navItems[0]?.id ?? '')
  const [prevNavItems, setPrevNavItems] = useState(navItems)
  const clickCooldown = useRef(0)

  if (navItems !== prevNavItems) {
    setPrevNavItems(navItems)
    setActiveId(navItems[0]?.id ?? '')
  }

  const handleNavigate = useCallback((id: string) => {
    setActiveId(id)
    clickCooldown.current = Date.now() + 800
  }, [])

  useEffect(() => {
    if (!navItems.length) return

    const OFFSET = 120 // matches scroll-mt-28 (~112px) with a small buffer

    const updateActive = () => {
      if (Date.now() < clickCooldown.current) return
      let bestId = navItems[0].id
      for (const item of navItems) {
        const el = document.getElementById(item.id)
        if (el && el.getBoundingClientRect().top <= OFFSET) {
          bestId = item.id
        }
      }
      setActiveId(bestId)
    }

    let ticking = false
    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(() => {
          updateActive()
          ticking = false
        })
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    updateActive() // set initial state

    return () => window.removeEventListener('scroll', onScroll)
  }, [navItems])

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="space-y-12">
        <OverviewSection
          serviceName={service.name}
          description={docs.serviceDescription}
        />
        <ApiOverviewSection overview={docs.overview} />
        <EndpointsSection endpoints={docs.endpoints ?? []} />
        <ResponseSection responseExample={docs.responseExample} />
        <SamplesSection
          intro={docs.sampleCodeIntro}
          samples={docs.sampleCode ?? []}
        />
      </div>
      <div className="hidden lg:block">
        <DocsNavigation
          navItems={navItems}
          activeId={activeId}
          onNavigate={handleNavigate}
        />
      </div>
    </div>
  )
}
