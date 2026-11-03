// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Activity,
  ArrowRight,
  Code2,
  Compass,
  Play,
  Plus,
  Power,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { TONES } from '@/components/common/tones'
import { plural } from '@/lib/browser/format'
import {
  CATALOG_HREF,
  countInstances,
  serviceHref,
} from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import { hasExecutionMode } from '@/services/execution'
import type { Service } from '@/services/types'
import type { SampleSuggestion } from './suggested-samples'

const MAX_STEPS = 3

interface NextStep {
  key: string
  title: string
  description: string
  href: string
  icon: LucideIcon
}

/**
 * The few things most worth doing next. Failures are left to Needs attention; status-based steps
 * are left out while status is not live.
 */
function nextSteps(
  services: readonly Service[],
  live: boolean,
  suggestions: readonly SampleSuggestion[],
): NextStep[] {
  const steps: NextStep[] = []
  // Built-in services run inside the studio: nothing to add or start.
  const runnable = services.filter(
    (s) => !hasExecutionMode(s.execution, 'none'),
  )
  const counts = countInstances(runnable.flatMap((s) => s.instances ?? []))

  if (live) {
    const ready = suggestions.find((s) => s.kind === 'ready')
    if (ready) {
      const { sample } = ready
      steps.push({
        key: 'try-sample',
        title: `Try ${sample.title}`,
        description: 'Every service it needs is running.',
        href:
          sample.demo.type === 'component'
            ? `/samples/${sample.id}/demo`
            : `/samples/${sample.id}`,
        icon: Play,
      })
    }
    if (counts.total === 0) {
      steps.push({
        key: 'add-service',
        title: 'Add a service',
        description: 'Run one AI capability on this machine and call its API.',
        href: CATALOG_HREF,
        icon: Plus,
      })
    } else if (counts.stopped > 0 && counts.running === 0) {
      // The first stopped instance by service name: its page has Start.
      const stopped = [...runnable]
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((service) =>
          (service.instances ?? []).map((instance) => ({ service, instance })),
        )
        .find(({ instance }) => countInstances([instance]).stopped === 1)
      steps.push({
        key: 'start-service',
        title: 'Start a service',
        description: `${plural(counts.stopped, 'instance')} added but stopped.`,
        href: stopped
          ? serviceHref(stopped.service.id, {
              instanceId: stopped.instance.instanceId,
            })
          : CATALOG_HREF,
        icon: Power,
      })
    }
    for (const service of runnable) {
      const running = service.instances?.find((i) => i.status === 'online')
      if (!running) continue
      steps.push({
        key: 'call-api',
        title: `Call ${service.name} from your code`,
        description:
          'Its Documentation tab lists the endpoints, with examples.',
        href: serviceHref(service.id, {
          instanceId: running.instanceId,
          tab: 'docs',
        }),
        icon: Code2,
      })
      break
    }
  }
  steps.push(
    {
      key: 'samples',
      title: 'Explore the samples',
      description: 'Complete applications built from these services.',
      href: '/samples',
      icon: Sparkles,
    },
    {
      key: 'monitor',
      title: 'Watch system resources',
      description: 'Processor, accelerator and memory use while models run.',
      href: '/system-monitoring',
      icon: Activity,
    },
  )
  return steps.slice(0, MAX_STEPS)
}

export function NextSteps({
  services,
  live,
  suggestions,
  className,
}: {
  services: readonly Service[]
  live: boolean
  suggestions: readonly SampleSuggestion[]
  className?: string
}) {
  const steps = nextSteps(services, live, suggestions)

  return (
    <section
      aria-labelledby="next-steps-title"
      className={cn('glass-card rounded-2xl p-4 sm:p-5', className)}
      data-testid="next-steps"
    >
      <h2
        id="next-steps-title"
        className="text-foreground flex items-center gap-2 text-base font-semibold"
      >
        <Compass aria-hidden="true" className="text-muted-foreground size-4" />
        Next steps
      </h2>
      <ul className="-mx-2 mt-2">
        {steps.map((step) => (
          <li key={step.key}>
            <Link
              href={step.href}
              className="group hover:bg-accent/60 focus-visible:ring-ring/50 flex items-center gap-3 rounded-xl px-2 py-2 outline-none focus-visible:ring-[3px]"
              data-testid={`next-step-${step.key}`}
            >
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-lg',
                  TONES.primary.iconBg,
                )}
              >
                <step.icon aria-hidden="true" className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground block text-sm font-medium">
                  {step.title}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {step.description}
                </span>
              </span>
              <ArrowRight
                aria-hidden="true"
                className="text-muted-foreground group-hover:text-primary size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
