// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ScrollText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Service } from '@/services/types'
import { ServiceLogTabs } from './service-log-tabs'

export function SampleLogDrawer({
  services,
  onClose,
}: {
  services: Service[]
  onClose: () => void
}) {
  if (services.length === 0) return null

  return (
    <div
      id="sample-log-drawer"
      className="glass-card animate-in slide-in-from-bottom-2 fade-in-0 overflow-hidden rounded-xl duration-200"
    >
      <div className="border-border flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ScrollText className="text-muted-foreground h-4 w-4" aria-hidden />
          <h2 className="text-foreground text-sm font-semibold">
            Service Logs
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="Close log drawer"
        >
          <X aria-hidden />
        </Button>
      </div>

      <ServiceLogTabs
        services={services}
        listContainerClassName="px-4"
        contentWrapperClassName="p-4"
      />
    </div>
  )
}
