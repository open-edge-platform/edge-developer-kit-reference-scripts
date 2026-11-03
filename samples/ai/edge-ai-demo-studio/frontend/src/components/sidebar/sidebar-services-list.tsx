// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Plus } from 'lucide-react'
import Link from 'next/link'
import { Skeleton } from '@/components/ui/skeleton'
import { useServiceStatus } from '@/context/service-status-context'
import { useSystemInfo } from '@/context/system-info-context'
import {
  CATALOG_HREF,
  getAttentionStatus,
  serviceHref,
} from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import { isServiceSupportedOnOS } from '@/services/registry'
import { useServicesInUse } from '@/services/_generated/in-use'
import { ServiceRailRow, type Row } from './service-rail-row'
import { isServiceInSidebar } from './service-rail'

/** Name-bar widths of the placeholder rows, varied like real service names. */
const LOADING_ROW_WIDTHS = ['w-28', 'w-20', 'w-32', 'w-24']

/** `Skeleton` in the sidebar's own tone — the page's `bg-accent` glares on it. */
function RailSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn('bg-sidebar-foreground/15', className)} />
}

/** Placeholder rail rows while services load, fading out since the count isn't known yet. */
function LoadingRows({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="space-y-0.5"
      data-testid="sidebar-services-loading"
    >
      <span className="sr-only">Loading services…</span>
      {LOADING_ROW_WIDTHS.map((width, i) => (
        <div
          key={width}
          className={cn(
            'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2',
            collapsed && 'justify-center px-2',
          )}
          style={{ opacity: 1 - i * 0.2 }}
        >
          <RailSkeleton className="size-4 shrink-0 rounded-[4px]" />
          {!collapsed && (
            <>
              <RailSkeleton className={cn('h-3 rounded-full', width)} />
              <RailSkeleton className="ml-auto size-2 shrink-0 rounded-full" />
            </>
          )}
        </div>
      ))}
    </div>
  )
}

export function SidebarServicesList({
  pathname,
  collapsed,
  onNavigate,
}: {
  pathname: string
  collapsed: boolean
  onNavigate?: () => void
}) {
  const { systemInfo } = useSystemInfo()
  const { services, loading } = useServiceStatus()
  const inUse = useServicesInUse()

  // Alphabetical, so a status change never moves the row under the pointer.
  const rows: Row[] = services
    .filter((s) => !s.hidden && isServiceInSidebar(s, inUse))
    .map((s) => ({
      service: s,
      instances: s.instances ?? [],
      // Worst-wins: one running instance must not hide a failed sibling.
      status: getAttentionStatus(s),
      unsupported: systemInfo
        ? !isServiceSupportedOnOS(s, systemInfo.os)
        : false,
      isCurrent: pathname === serviceHref(s.id),
    }))
    .sort((a, b) => a.service.name.localeCompare(b.service.name))

  // "+" leads to the Catalog, where each service says what adding it involves.
  const addButton = (
    <Link
      href={CATALOG_HREF}
      onClick={onNavigate}
      aria-label="Add service"
      title="Add service"
      data-testid="sidebar-add-service"
      className={cn(
        'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground focus-visible:ring-sidebar-ring flex items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2',
        // Collapsed, the "+" has no "Services" label beside it: a dashed
        // outline says "add" on its own.
        collapsed
          ? 'border-sidebar-foreground/25 hover:border-sidebar-foreground/50 size-9 border border-dashed'
          : 'size-8',
      )}
    >
      <Plus className="h-4 w-4" />
    </Link>
  )

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col',
        // Collapsed, a rule stands in for the "Services" heading.
        collapsed ? 'border-sidebar-border mt-3 border-t pt-3' : 'pt-4',
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center pb-3',
          collapsed ? 'justify-center' : 'justify-between px-2',
        )}
      >
        {!collapsed && (
          <span className="text-sidebar-foreground/60 text-xs font-semibold tracking-wider uppercase">
            Services
          </span>
        )}
        {addButton}
      </div>

      {/* Its own scroll region, so the nav items above never scroll away. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <LoadingRows collapsed={collapsed} />
        ) : (
          <div className="space-y-0.5">
            {rows.map((row) => (
              <ServiceRailRow
                key={row.service.id}
                row={row}
                collapsed={collapsed}
                os={systemInfo?.os}
                onNavigate={onNavigate}
              />
            ))}

            {rows.length === 0 && !collapsed && (
              <div className="px-3 py-6 text-center">
                <p className="text-sidebar-foreground text-[13px] font-semibold">
                  No services added yet
                </p>
                <p className="text-sidebar-foreground/60 mt-1.5 text-xs leading-relaxed">
                  Services you add stay here, running or not.
                </p>
                <Link
                  href={CATALOG_HREF}
                  onClick={onNavigate}
                  className="text-sidebar-accent-foreground mt-3 inline-flex min-h-8 items-center gap-1 text-xs font-medium hover:underline"
                >
                  <Plus className="h-3 w-3" />
                  Add service
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
