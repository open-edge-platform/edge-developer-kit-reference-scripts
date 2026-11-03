// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowUpRight, Ban, Cpu, Download, Monitor, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { ServiceLink } from '@/components/common/service-link'
import { type Tone, TONES } from '@/components/common/tones'
import { InlineNotice } from '@/components/common/inline-notice'
import { TruncatedText } from '@/components/common/truncated-text'
import {
  failedInstancesLink,
  InstanceStateSummary,
} from '@/components/services/instance-state-summary'
import { NewInstanceSheet } from '@/components/services/new-instance-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useServiceStatus } from '@/context/service-status-context'
import {
  countInstances,
  getServiceMembership,
  MEMBERSHIP_LABEL,
  type ServiceMembership,
  serviceHref,
} from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import type { Service } from '@/services/types'
import { getOSLabel, type HostOS } from '@/types/common'

const MEMBERSHIP_TONE: Record<ServiceMembership, Tone> = {
  added: 'primary',
  'not-added': 'muted',
  'built-in': 'info',
  unavailable: 'warning',
}

const BADGE_CLASS = 'shrink-0 px-2.5 py-1 text-xs'

function MembershipBadge({ membership }: { membership: ServiceMembership }) {
  return (
    <Badge
      tone={MEMBERSHIP_TONE[membership]}
      className={BADGE_CLASS}
      data-testid="service-membership"
    >
      {membership === 'unavailable' && (
        <Ban aria-hidden="true" className="size-3" />
      )}
      {MEMBERSHIP_LABEL[membership]}
    </Badge>
  )
}

interface ServiceCardProps {
  service: Service
  unsupportedOS?: boolean
  currentOS?: HostOS
  index?: number
  /** Catalog card: ends with the one action its membership allows. */
  showActions?: boolean
}

/** One service card. Every instance state is counted, so a running one never hides a failed sibling. */
export function ServiceCard({
  service,
  unsupportedOS = false,
  currentOS,
  index = 0,
  showActions = false,
}: ServiceCardProps) {
  const { connectionError } = useServiceStatus()
  const router = useRouter()
  const membership = getServiceMembership(service, !unsupportedOS)
  const instances = service.instances ?? []
  const counts = countInstances(instances)
  // Without a live answer: no counts, no membership, no add.
  const live = !connectionError
  const liveModel = service.currentModel ?? service.model
  const liveDevice = service.currentDevice ?? service.hardware

  const accent = unsupportedOS
    ? 'bg-muted-foreground/10'
    : !live
      ? 'bg-muted-foreground/20'
      : counts.failed > 0
        ? 'bg-destructive/60'
        : counts.running > 0
          ? 'from-primary to-intel-teal bg-gradient-to-r'
          : counts.starting > 0
            ? 'bg-muted-foreground/20 animate-pulse'
            : 'bg-muted-foreground/20'

  return (
    <div
      className={cn(
        'glass-card group card-stagger relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl p-5',
        unsupportedOS ? 'opacity-60' : 'card-lift',
      )}
      style={{ '--card-index': index } as React.CSSProperties}
      data-testid={`service-card-${service.id}`}
    >
      <div
        className={cn(
          'accent-line-animate absolute top-0 h-[3px] transition-colors',
          accent,
        )}
      />

      <div className="flex items-center justify-between gap-3">
        <div
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors duration-200',
            unsupportedOS
              ? 'bg-muted text-muted-foreground'
              : 'bg-primary/8 text-primary group-hover:bg-primary/15',
          )}
        >
          <service.icon className="size-5" />
        </div>
        {!live && membership !== 'unavailable' ? (
          <Badge tone="muted" className={cn(BADGE_CLASS, 'border-transparent')}>
            Status unavailable
          </Badge>
        ) : (
          <MembershipBadge membership={membership} />
        )}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <h3
          className={cn(
            'text-sm font-semibold',
            unsupportedOS
              ? 'text-muted-foreground'
              : 'text-foreground group-hover:text-primary transition-colors',
          )}
        >
          {unsupportedOS ? (
            service.name
          ) : (
            // Stretched over the card; the action buttons sit above it.
            <ServiceLink
              serviceType={service.id}
              className="focus-visible:after:ring-ring/50 rounded-sm outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-[3px]"
            >
              {service.name}
            </ServiceLink>
          )}
        </h3>
        {!unsupportedOS && (
          <ArrowUpRight className="text-muted-foreground/50 group-hover:text-primary size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        )}
      </div>

      <p className="text-muted-foreground mt-2 line-clamp-2 flex-1 text-[13px] leading-relaxed">
        {service.description}
      </p>

      {unsupportedOS && (
        <InlineNotice
          tone="warning"
          className="mt-3 gap-1.5 px-2.5 py-1.5"
          icon={
            <Monitor
              aria-hidden="true"
              className="text-warning h-3 w-3 shrink-0"
            />
          }
        >
          {currentOS
            ? `Not available on ${getOSLabel(currentOS)}`
            : 'Not supported on this system'}
        </InlineNotice>
      )}

      <div className="mt-auto flex flex-col gap-3 pt-4">
        {(liveModel || liveDevice) && (
          <ModelAndDevice model={liveModel} device={liveDevice} />
        )}

        {/* One strip whatever the instance count, so cards keep the same height. */}
        {live && counts.total > 0 && (
          <div className="border-border/60 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3">
            <InstanceStateSummary
              instances={instances}
              failedLink={failedInstancesLink(service)}
            />
            {counts.total > 1 && (
              <span className="text-muted-foreground ml-auto text-xs">
                {counts.total} instances
              </span>
            )}
          </div>
        )}

        {showActions && membership !== 'unavailable' && (
          <div className="relative z-10 flex flex-wrap gap-2">
            {live && membership === 'not-added' ? (
              <NewInstanceSheet
                serviceType={service.id}
                onCreated={(doc) =>
                  router.push(
                    serviceHref(doc.type, { instanceId: doc.instanceId }),
                  )
                }
                trigger={
                  <Button
                    size="sm"
                    variant="outline"
                    // Outlined: a grid of filled buttons would drown the
                    // page's own Add service.
                    className="border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
                    data-testid={`catalog-add-${service.id}`}
                    aria-label={`Add ${service.name}`}
                  >
                    <Plus />
                    Add service
                  </Button>
                }
              />
            ) : (
              <Button
                asChild
                size="sm"
                variant="outline"
                data-testid={`catalog-open-${service.id}`}
              >
                <ServiceLink
                  serviceType={service.id}
                  aria-label={
                    live && membership === 'added'
                      ? `Manage ${service.name}`
                      : `Open ${service.name}`
                  }
                >
                  {live && membership === 'added' ? 'Manage service' : 'Open'}
                </ServiceLink>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const FACT_PILL =
  'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium'

/** Model and device pills; above the card's stretched link, so the name can be focused and tapped. */
function ModelAndDevice({
  model,
  device,
}: {
  model: string | undefined
  device: string | undefined
}) {
  return (
    <dl className="relative z-10 flex min-w-0 flex-wrap items-center gap-1.5">
      {model && (
        <div className={cn(FACT_PILL, TONES.primary.pill)}>
          <dt className="sr-only">Model</dt>
          <Download aria-hidden="true" className="size-3 shrink-0" />
          <dd className="min-w-0">
            <TruncatedText text={model} className="max-w-[15rem]" />
          </dd>
        </div>
      )}
      {device && (
        <div className={cn(FACT_PILL, TONES.info.pill)}>
          <dt className="sr-only">Device</dt>
          <Cpu aria-hidden="true" className="size-3 shrink-0" />
          <dd>{device}</dd>
        </div>
      )}
    </dl>
  )
}
