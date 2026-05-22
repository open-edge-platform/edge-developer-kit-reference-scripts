// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ServiceConfigureDispatch } from '@/services/common/demo/components/service-configure-dispatch'
import { services, visibleServices } from '@/services/registry'
import { hasExecutionMode } from '@/services/types'
import {
  ServiceAccentBar,
  ServiceActionButton,
  ServiceLiveBadges,
  ServiceLiveStatus,
} from './service-actions'
import { ServiceDetailTabs } from './tabs'

export function generateStaticParams() {
  return services.map((s) => ({ serviceId: s.id }))
}

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ serviceId: string }>
}) {
  const { serviceId } = await params
  const service = visibleServices.find((s) => s.id === serviceId)

  if (!service) {
    notFound()
  }

  const isNoneMode = hasExecutionMode(service.execution, 'none')

  return (
    <div className="space-y-6">
      <Link
        href="/services"
        className="group text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition-colors"
      >
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
        Back to Services
      </Link>

      <div
        className="section-fade glass-card relative overflow-hidden rounded-xl p-6"
        style={{ '--stagger': 0 } as React.CSSProperties}
      >
        <ServiceAccentBar
          service={{ id: service.id, status: service.status }}
        />

        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'flex h-14 w-14 shrink-0 items-center justify-center rounded-xl transition-all',
                service.status === 'online'
                  ? 'from-primary/20 to-secondary/10 text-primary shadow-primary/10 bg-gradient-to-br shadow-md'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <service.icon className="h-7 w-7" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-foreground text-2xl font-bold">
                  {service.name}
                </h1>
                {!isNoneMode && (
                  <ServiceLiveStatus
                    service={{ id: service.id, status: service.status }}
                  />
                )}
              </div>
              <p className="text-muted-foreground mt-1.5 max-w-xl text-sm leading-relaxed">
                {service.description}
              </p>
              <ServiceLiveBadges
                service={{
                  id: service.id,
                  fallbackModel: service.model,
                  fallbackHardware: service.hardware,
                }}
              />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ServiceConfigureDispatch serviceId={service.id} />
            {!isNoneMode && (
              <ServiceActionButton
                service={{ id: service.id, status: service.status }}
              />
            )}
          </div>
        </div>
      </div>

      <div
        className="section-fade"
        style={{ '--stagger': 1 } as React.CSSProperties}
      >
        <ServiceDetailTabs serviceId={service.id} />
      </div>
    </div>
  )
}
