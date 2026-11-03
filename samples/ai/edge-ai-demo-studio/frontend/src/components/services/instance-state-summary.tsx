// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import Link from 'next/link'
import {
  shapedStatusDotClass,
  STATUS_TONE,
  TONES,
} from '@/components/common/tones'
import { startupErrorsHref } from '@/components/services/startup-details'
import type { StartupTelemetry } from '@/lib/instances/runtime-fields'
import {
  countInstances,
  serviceHref,
  STATE_LABEL,
  SUMMARY_STATES,
} from '@/lib/instances/service-presentation'
import { STARTUP_STAGE_LABEL } from '@/lib/instances/startup-presentation'
import { cn } from '@/lib/utils'
import type { Service, ServiceStatus } from '@/services/types'

interface FailedLink {
  href: string
  label: string
}

/** The first failed instance's logs (filtered to errors when its start reported them), if any. */
export function failedInstancesLink(
  service: Pick<Service, 'id' | 'instances'>,
): FailedLink | undefined {
  const first = (service.instances ?? []).find((i) => i.status === 'error')
  if (!first) return undefined
  const errorsHref = startupErrorsHref(first)
  if (errorsHref) {
    return {
      href: errorsHref,
      label: `View errors of failed instance ${first.label}`,
    }
  }
  return {
    href: serviceHref(service.id, {
      instanceId: first.instanceId,
      tab: 'logs',
    }),
    label: `View logs of failed instance ${first.label}`,
  }
}

/**
 * "● 1 running  ■ 1 failed": instance counts per state, with shaped dots so they read without
 * colour. A single instance reads as its state alone (or its startup stage).
 */
export function InstanceStateSummary({
  instances,
  failedLink,
  className,
}: {
  instances: readonly { status: ServiceStatus; startup?: StartupTelemetry }[]
  failedLink?: FailedLink
  className?: string
}) {
  const counts = countInstances(instances)
  if (counts.total === 0) return null
  const single = counts.total === 1
  const stage =
    single && instances[0].status === 'starting'
      ? instances[0].startup?.stage
      : undefined

  return (
    <span
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium',
        className,
      )}
      data-testid="instance-state-summary"
    >
      {SUMMARY_STATES.filter(([key]) => counts[key] > 0).map(
        ([key, status]) => {
          const content = (
            <>
              <span
                aria-hidden="true"
                className={cn('size-2 shrink-0', shapedStatusDotClass(status))}
              />
              {stage && status === 'starting' ? (
                <>
                  <span className="sr-only">{STATE_LABEL[status]}: </span>
                  {STARTUP_STAGE_LABEL[stage]}
                </>
              ) : single ? (
                STATE_LABEL[status]
              ) : (
                `${counts[key]} ${key}`
              )}
            </>
          )
          const className = cn(
            'inline-flex items-center gap-1.5 whitespace-nowrap',
            TONES[STATUS_TONE[status]].text,
          )
          if (status === 'error' && failedLink) {
            return (
              <Link
                key={key}
                href={failedLink.href}
                className={cn(
                  className,
                  'focus-visible:ring-ring/50 relative z-10 rounded-sm underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-[3px]',
                )}
                aria-label={failedLink.label}
              >
                {content}
              </Link>
            )
          }
          return (
            <span key={key} className={className}>
              {content}
            </span>
          )
        },
      )}
    </span>
  )
}
