// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { visibleServices } from '@/services/registry'
import { ServiceDetailContent } from './service-detail-content'

interface ServiceDetailPageProps {
  params: Promise<{ serviceId: string }>
}

/** A hidden service has no page: only visible ones are listed or rendered. */
function findVisibleService(serviceId: string) {
  return visibleServices.find((s) => s.id === serviceId)
}

export function generateStaticParams() {
  return visibleServices.map((s) => ({ serviceId: s.id }))
}

export async function generateMetadata({
  params,
}: ServiceDetailPageProps): Promise<Metadata> {
  const service = findVisibleService((await params).serviceId)
  if (!service) return { title: 'Service not found' }
  return { title: service.name, description: service.description }
}

export default async function ServiceDetailPage({
  params,
}: ServiceDetailPageProps) {
  const { serviceId } = await params
  const service = findVisibleService(serviceId)

  if (!service) {
    notFound()
  }

  // Identity only: instance, status and actions live in ServiceControlBar.
  return (
    <div className="space-y-4">
      <div
        className="service-heading relative isolate overflow-hidden rounded-2xl px-4 py-4 sm:px-5 sm:py-5 [@media(max-height:560px)]:py-3"
        data-testid="service-heading"
      >
        <service.icon
          aria-hidden="true"
          strokeWidth={1.25}
          className="text-primary/10 pointer-events-none absolute top-1/2 right-10 -z-10 hidden size-24 -translate-y-1/2 -rotate-6 md:block"
        />
        <div className="flex min-w-0 items-center gap-3 sm:gap-4 md:pr-36">
          <div className="bg-primary/10 text-primary ring-primary/20 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset sm:size-12">
            <service.icon aria-hidden="true" className="size-5 sm:size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-foreground text-[22px] leading-tight font-semibold tracking-tight break-words sm:text-[26px] lg:text-[28px]">
              {service.name}
            </h1>
            <p className="text-muted-foreground mt-1 line-clamp-2 max-w-3xl text-sm leading-relaxed [@media(max-height:560px)]:line-clamp-1">
              {service.description}
            </p>
          </div>
        </div>
      </div>

      <ServiceDetailContent serviceId={service.id} />
    </div>
  )
}
