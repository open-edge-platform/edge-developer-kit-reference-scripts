// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Search, SearchX, X } from 'lucide-react'
import { useState } from 'react'
import { Accordion } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ApiEndpoint } from '@/services/types'
import { type BackendContext, backendLabels } from './backend-badge'
import { EndpointItem } from './endpoint-item'

const endpointKey = (endpoint: ApiEndpoint) =>
  `${endpoint.method}:${endpoint.path}`

/** Which backend the selected instance runs, or with no instance, that backend-only items are marked. */
function BackendNote({ backends }: { backends: BackendContext }) {
  const active = backends.active
  return (
    <p
      className="text-muted-foreground text-xs leading-5"
      data-testid="docs-backend-note"
    >
      {active ? (
        <>
          This instance runs the{' '}
          <span className="text-foreground font-semibold">
            {backendLabels([active], backends)}
          </span>
          . Endpoints and parameters marked for another backend are not
          available on it.
        </>
      ) : (
        'Some endpoints and parameters are only available on one backend; each is marked.'
      )}
    </p>
  )
}

/** The service's endpoints, searchable, each expanding to its parameters. */
export function EndpointsSection({
  endpoints,
  backends,
}: {
  endpoints: ApiEndpoint[]
  backends: BackendContext
}) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])
  const query = search.trim().toLowerCase()
  const filtered = endpoints.filter((endpoint) =>
    [
      endpoint.method,
      endpoint.path,
      endpoint.description,
      ...(endpoint.params ?? []).map((param) => param.name),
      ...(endpoint.backends?.length
        ? [backendLabels(endpoint.backends, backends)]
        : []),
    ].some((value) => value.toLowerCase().includes(query)),
  )
  const allExpanded =
    filtered.length > 0 &&
    filtered.every((endpoint) => expanded.includes(endpointKey(endpoint)))

  if (!endpoints.length) return null
  return (
    <section
      id="endpoints"
      tabIndex={-1}
      className="docs-section space-y-4"
      aria-labelledby="endpoints-heading"
    >
      <div className="flex items-center gap-2">
        <h2 id="endpoints-heading" className="text-lg font-semibold">
          Endpoints
        </h2>
        <Badge variant="secondary" className="tabular-nums">
          {endpoints.length}
        </Badge>
      </div>
      {endpoints.some((endpoint) => endpoint.backends?.length) && (
        <BackendNote backends={backends} />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-3 left-3 size-4"
          />
          <Input
            aria-label="Search endpoints"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search endpoints or parameters…"
            className="bg-muted/25 h-10 pr-9 pl-9"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-1 right-1"
              aria-label="Clear endpoint search"
              onClick={() => setSearch('')}
            >
              <X />
            </Button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={filtered.length === 0}
          onClick={() => {
            const keys = filtered.map(endpointKey)
            setExpanded((current) =>
              allExpanded
                ? current.filter((key) => !keys.includes(key))
                : [...new Set([...current, ...keys])],
            )
          }}
        >
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </Button>
      </div>
      {query && (
        <p role="status" className="text-muted-foreground text-xs">
          {filtered.length} of {endpoints.length} endpoints
        </p>
      )}
      {filtered.length > 0 ? (
        <Accordion
          type="multiple"
          value={expanded}
          onValueChange={setExpanded}
          className="space-y-3"
        >
          {filtered.map((endpoint) => (
            <EndpointItem
              key={endpointKey(endpoint)}
              value={endpointKey(endpoint)}
              endpoint={endpoint}
              backends={backends}
            />
          ))}
        </Accordion>
      ) : (
        <div className="border-border flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-8">
          <SearchX className="text-muted-foreground size-5" />
          <p className="text-sm">No endpoints found</p>
          <Button variant="outline" size="sm" onClick={() => setSearch('')}>
            Clear search
          </Button>
        </div>
      )}
    </section>
  )
}
