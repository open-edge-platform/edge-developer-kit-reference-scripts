// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { PackagePlus, Search, SearchX, X } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/common/empty-state'
import { PageHeading } from '@/components/shell/page-heading'
import { ServiceCard } from '@/components/services/service-card'
import { ServiceCardSkeleton } from '@/components/services/service-card-skeleton'
import {
  recordServicesView,
  useServicesReturnContext,
} from '@/components/services/services-list-return'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useServiceStatus } from '@/context/service-status-context'
import { useSystemInfo } from '@/context/system-info-context'
import {
  type SearchParamsPatch,
  useUrlSearchState,
} from '@/hooks/use-url-search-state'
import {
  matchesServiceFilter,
  matchesServiceSearch,
  type ServiceFilter,
} from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import { isServiceSupportedOnOS } from '@/services/registry'
import type { Service } from '@/services/types'

const FILTERS: { value: ServiceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'added', label: 'Added' },
  { value: 'running', label: 'Running' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'attention', label: 'Needs attention' },
]

function parseFilter(value: string | null): ServiceFilter {
  return FILTERS.find((f) => f.value === value)?.value ?? 'all'
}

function Heading() {
  return (
    <PageHeading
      eyebrow="Build with local AI"
      title="Services"
      description="Add AI capabilities to your workspace, then run, test and manage their instances."
    />
  )
}

/** What the page shows until the address (only known in the browser) is read. */
export function ServicesPageSkeleton() {
  return (
    <div className="space-y-6">
      <Heading />
      <ListSkeleton />
    </div>
  )
}

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading services…</span>
      <Skeleton
        aria-hidden="true"
        className="h-[72px] w-full rounded-2xl sm:h-20"
      />
      <div
        aria-hidden="true"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <ServiceCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

/**
 * The services catalogue with search and filters, in a stable alphabetical order (unsupported
 * last) so polling only changes badges.
 */
export function ServicesContent() {
  const { systemInfo } = useSystemInfo()
  const { services, loading, connectionError, stale } = useServiceStatus()
  const [searchParams, writeSearchParams] = useUrlSearchState()
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const filter = parseFilter(searchParams.get('filter'))

  // Membership and state as last answered; the filters wait without them.
  const live = !connectionError
  const known = live || stale

  // Returning through the breadcrumb or Back scrolls to where the user left
  // once the list is on screen.
  useServicesReturnContext(!loading)

  const supported = (s: Service) =>
    !systemInfo || isServiceSupportedOnOS(s, systemInfo.os)
  const visible = services.filter((s) => !s.hidden)
  const matches = visible
    .filter((s) => matchesServiceSearch(s, search))
    // The system never changes while the page is open, so the order stays put.
    .sort(
      (a, b) =>
        Number(!supported(a)) - Number(!supported(b)) ||
        a.name.localeCompare(b.name),
    )
  const shown = known
    ? matches.filter((s) => matchesServiceFilter(s, filter))
    : matches
  const noneAdded = known && !visible.some((s) => s.added)

  // Every search or filter is also the view the breadcrumb and Back return to.
  const writeParams = (patch: SearchParamsPatch) => {
    writeSearchParams(patch)
    recordServicesView()
  }
  const changeSearch = (next: string) => {
    setSearch(next)
    writeParams({ q: next.trim() ? next : null })
  }
  const chooseFilter = (next: ServiceFilter) =>
    writeParams({ filter: next === 'all' ? null : next })
  const clearAll = () => {
    setSearch('')
    writeParams({ q: null, filter: null })
  }

  return (
    // A click that leaves the list (a service, an instance, its logs)
    // records the moment just before leaving as the view to return to.
    <div className="space-y-6" onClickCapture={recordServicesView}>
      <Heading />

      {loading ? (
        <ListSkeleton />
      ) : (
        <>
          {/* The search takes the room the filters leave; the filters wrap below when short. */}
          <div className="glass-card flex flex-wrap items-center gap-3 rounded-2xl p-4 sm:p-5">
            <div className="relative min-w-64 flex-1">
              <Search
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute top-3 left-3 size-4"
              />
              <Input
                type="search"
                aria-label="Search services, instances, models or devices"
                placeholder="Search services, instances, models…"
                value={search}
                onChange={(e) => changeSearch(e.target.value)}
                className="bg-background/70 h-10 pr-10 pl-10 [&::-webkit-search-cancel-button]:hidden"
                data-testid="services-search"
              />
              {search && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-1 right-1"
                  aria-label="Clear search"
                  onClick={() => changeSearch('')}
                >
                  <X />
                </Button>
              )}
            </div>
            <div
              role="group"
              aria-label="Filter services"
              className="flex flex-wrap gap-2"
            >
              {FILTERS.map(({ value, label }) => {
                const active = known ? filter === value : value === 'all'
                return (
                  <Button
                    key={value}
                    variant={active ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-pressed={active}
                    onClick={() => chooseFilter(value)}
                    // Without status, only All has anything to show.
                    disabled={!known && value !== 'all'}
                    className={cn(
                      'h-9 gap-2 rounded-lg text-xs',
                      active && 'text-primary ring-primary/15 ring-1',
                    )}
                    data-testid={`services-filter-${value}`}
                  >
                    {label}
                    <CountBadge
                      active={active}
                      value={
                        known || value === 'all'
                          ? matches.filter((s) =>
                              matchesServiceFilter(s, value),
                            ).length
                          : undefined
                      }
                    />
                  </Button>
                )
              })}
            </div>
            {/* The active filter's badge shows the same count. */}
            <p role="status" className="sr-only">
              {shown.length} of {visible.length} services
            </p>
          </div>

          {shown.length === 0 && filter === 'added' && noneAdded ? (
            <EmptyState
              icon={PackagePlus}
              title="No services added yet"
              description="Add a service from the full list to run it on this machine. Everything you add is listed here, running or not."
              tone="primary"
            >
              <Button onClick={() => chooseFilter('all')}>
                Show all services
              </Button>
            </EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No services match"
              description="Try another service, instance, model or device name, or clear the search and filters."
              tone="primary"
            >
              <Button variant="outline" onClick={clearAll}>
                Clear search and filters
              </Button>
            </EmptyState>
          ) : (
            <ul
              className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
              aria-label="Services"
            >
              {shown.map((service, i) => (
                <li key={service.id} className="min-w-0">
                  <ServiceCard
                    service={service}
                    unsupportedOS={!supported(service)}
                    currentOS={systemInfo?.os}
                    index={i}
                    showActions
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function CountBadge({
  value,
  active = false,
}: {
  value: number | undefined
  active?: boolean
}) {
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-0.5 text-xs tabular-nums',
        active
          ? 'bg-primary/10 text-primary'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {value ?? '—'}
    </span>
  )
}
