// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertTriangle, ArrowRight, ScrollText } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { ServiceLink } from '@/components/common/service-link'
import { shapedStatusDotClass, TONES } from '@/components/common/tones'
import { TruncatedText } from '@/components/common/truncated-text'
import { Button } from '@/components/ui/button'
import { plural } from '@/lib/browser/format'
import {
  instanceSummary,
  STATE_LABEL,
} from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import type { Service, ServiceInstance } from '@/services/types'

/** How many failed instances the dashboard names before "Show all". */
const MAX_SHOWN = 5

/** The services with a failed instance, on the Services page. */
const ATTENTION_HREF = '/services?filter=attention'

interface FailedInstance {
  service: Service
  instance: ServiceInstance
}

/** Every failed instance, by service name, then in creation order. */
function failedInstances(services: readonly Service[]): FailedInstance[] {
  return [...services]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((service) =>
      (service.instances ?? [])
        .filter((instance) => instance.status === 'error')
        .map((instance) => ({ service, instance })),
    )
}

/**
 * Every failed instance with links to its page and logs. Per instance, not per service, so a failure
 * stays in view while a sibling instance runs.
 */
export function NeedsAttention({ services }: { services: readonly Service[] }) {
  const [showAll, setShowAll] = useState(false)
  const failed = failedInstances(services)
  if (failed.length === 0) return null
  const shown = showAll ? failed : failed.slice(0, MAX_SHOWN)
  const more = failed.length - shown.length

  return (
    <section
      aria-labelledby="needs-attention-title"
      className={cn(
        'section-fade rounded-2xl border p-4 sm:p-5',
        TONES.destructive.surface,
      )}
      data-testid="needs-attention"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2
          id="needs-attention-title"
          className="text-foreground flex items-center gap-2 text-base font-semibold"
        >
          <AlertTriangle
            aria-hidden="true"
            className={cn('size-4', TONES.destructive.text)}
          />
          Needs attention
          <span className="text-muted-foreground text-sm font-normal">
            {plural(failed.length, 'failed instance')}
          </span>
        </h2>
        <Link
          href={ATTENTION_HREF}
          className="view-all-link text-primary flex items-center gap-1.5 text-xs font-semibold"
        >
          Show in Services
          <ArrowRight aria-hidden="true" className="view-all-arrow size-3.5" />
        </Link>
      </div>

      <ul className="divide-destructive/15 mt-2 divide-y">
        {shown.map(({ service, instance }) => (
          <FailedRow
            key={instance.instanceKey}
            service={service}
            instance={instance}
          />
        ))}
      </ul>
      {more > 0 && (
        <p className="text-muted-foreground mt-2 text-xs">
          {plural(more, 'more failed instance')} ·{' '}
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-primary focus-visible:ring-ring/50 rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px]"
          >
            Show all
          </button>
        </p>
      )}
    </section>
  )
}

function FailedRow({
  service,
  instance,
}: {
  service: Service
  instance: ServiceInstance
}) {
  const siblings = service.instances ?? []
  // The instance name alone when it is the service's own name.
  const named = instance.label !== service.name

  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
      data-testid={`attention-${instance.instanceKey}`}
    >
      <div className="flex min-w-0 flex-1 basis-60 items-start gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            'mt-1.5 size-2 shrink-0',
            shapedStatusDotClass('error'),
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <ServiceLink
              serviceType={service.id}
              instanceId={instance.instanceId}
              className="text-foreground hover:text-primary focus-visible:ring-ring/50 rounded-sm font-semibold outline-none focus-visible:ring-[3px]"
              aria-label={`Open instance ${instance.label} of ${service.name}`}
            >
              {named ? instance.label : service.name}
            </ServiceLink>
            {named && (
              <span className="text-muted-foreground"> · {service.name}</span>
            )}
          </p>
          <div
            className={cn(
              'flex min-w-0 items-baseline gap-1.5 text-xs',
              TONES.destructive.strongText,
            )}
          >
            <span className="shrink-0 font-medium">{STATE_LABEL.error}</span>
            {instance.statusMessage && (
              <>
                <span aria-hidden="true">·</span>
                <TruncatedText
                  text={instance.statusMessage}
                  className="min-w-0 flex-1"
                />
              </>
            )}
          </div>
          {siblings.length > 1 && (
            <p className="text-muted-foreground mt-0.5 text-xs">
              {service.name}: {instanceSummary(siblings)}
            </p>
          )}
        </div>
      </div>
      <Button asChild variant="outline" size="sm" className="bg-background/70">
        <ServiceLink
          serviceType={service.id}
          instanceId={instance.instanceId}
          tab="logs"
          logLevel="ERROR"
          aria-label={`View errors in the logs of ${instance.label}`}
        >
          <ScrollText />
          View logs
        </ServiceLink>
      </Button>
    </li>
  )
}
