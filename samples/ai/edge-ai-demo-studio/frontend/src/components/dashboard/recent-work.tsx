// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { History, Play, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { shapedStatusDotClass } from '@/components/common/tones'
import { useServiceStatus } from '@/context/service-status-context'
import { type RecentVisit, useRecentWork } from '@/hooks/use-service-shortcuts'
import { formatTimeAgo } from '@/lib/browser/format'
import { serviceHref, STATE_LABEL } from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import { getSampleById } from '@/samples/registry'
import type { ServiceStatus } from '@/services/types'

const MAX_SHOWN = 5

interface RecentItem {
  key: string
  href: string
  icon: LucideIcon
  title: string
  /** What it is: "Service", "Instance GPU chat", "Sample demo"… */
  kind: string
  /** The instance's live state, when it has one and status is live. */
  status?: ServiceStatus
  at: number
}

/** "3 min ago", "2 h ago", then days. */
function ago(at: number, now: number): string {
  const days = Math.floor((now - at) / 86_400_000)
  if (days >= 1) return days === 1 ? 'yesterday' : `${days} days ago`
  return formatTimeAgo(at, Math.max(now, at))
}

/** A clock for "… ago" labels that moves on every half minute. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/**
 * Services, instances and samples opened last, newest first, linking back to where the user was.
 * Things that no longer exist are left out; a deleted instance leads to its service.
 */
export function RecentWork({ className }: { className?: string }) {
  const visits = useRecentWork()
  const { serviceById, connectionError } = useServiceStatus()
  const now = useNow()

  const resolve = (visit: RecentVisit): RecentItem | undefined => {
    if (visit.kind === 'sample') {
      const sample = getSampleById(visit.id)
      if (!sample) return undefined
      return {
        key: `sample:${visit.id}`,
        href: visit.demo ? `/samples/${visit.id}/demo` : `/samples/${visit.id}`,
        icon: visit.demo ? Play : Sparkles,
        title: sample.title,
        kind: visit.demo ? 'Sample demo' : 'Sample',
        at: visit.at,
      }
    }
    const service = serviceById.get(visit.id)
    if (!service) return undefined
    const instances = service.instances ?? []
    // No id in the address: the service's first instance was shown.
    const instance = visit.instanceId
      ? instances.find((i) => i.instanceId === visit.instanceId)
      : instances[0]
    const named = instance && instances.length > 1
    return {
      key: `service:${visit.id}`,
      href: serviceHref(service.id, {
        instanceId:
          instance && visit.instanceId ? instance.instanceId : undefined,
      }),
      icon: service.icon,
      title: service.name,
      kind: named ? `Instance ${instance.label}` : 'Service',
      status: instance && !connectionError ? instance.status : undefined,
      at: visit.at,
    }
  }

  const items = visits
    .map(resolve)
    .filter((item): item is RecentItem => item !== undefined)
    .slice(0, MAX_SHOWN)

  return (
    <section
      aria-labelledby="recent-work-title"
      className={cn('glass-card rounded-2xl p-4 sm:p-5', className)}
      data-testid="recent-work"
    >
      <h2
        id="recent-work-title"
        className="text-foreground flex items-center gap-2 text-base font-semibold"
      >
        <History aria-hidden="true" className="text-muted-foreground size-4" />
        Recent work
      </h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">
          Services, instances and samples you open appear here, so you can
          return to them in one click.
        </p>
      ) : (
        <ul className="-mx-2 mt-2">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="hover:bg-accent/60 focus-visible:ring-ring/50 flex items-center gap-3 rounded-xl px-2 py-2 outline-none focus-visible:ring-[3px]"
              >
                <span className="bg-primary/8 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <item.icon aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-sm font-medium">
                    {item.title}
                  </span>
                  <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                    <span className="truncate">{item.kind}</span>
                    {item.status && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span
                          aria-hidden="true"
                          className={cn(
                            'size-2 shrink-0',
                            shapedStatusDotClass(item.status),
                          )}
                        />
                        <span className="shrink-0">
                          {STATE_LABEL[item.status]}
                        </span>
                      </>
                    )}
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {ago(item.at, now)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
