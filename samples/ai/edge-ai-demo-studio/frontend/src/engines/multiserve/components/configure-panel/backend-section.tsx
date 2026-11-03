// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Ban } from 'lucide-react'
import { ConfigSection } from '@/components/configure/config-section'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getBackend, supportedBackends } from '@/engines/multiserve/backends'
import type { BackendId } from '@/engines/multiserve/types'
import { getOSLabel, type HostOS } from '@/types/common'

/** One button per backend: the OS's recommended one marked, unsupported ones disabled. */
export function BackendSection({
  value,
  os,
  onChange,
}: {
  value: BackendId
  /** The host OS; unknown while system info loads. */
  os?: HostOS
  onChange: (backend: string) => void
}) {
  const selectedBackend = getBackend(value)
  return (
    <ConfigSection title="Backend">
      <div className="grid grid-cols-2 gap-2">
        {supportedBackends.map((b) => {
          const isUnsupported =
            os != null && !b.supportedOS.some((supported) => supported === os)
          const isRecommended = os != null && b.recommendedOS === os

          const button = (
            <Button
              key={b.value}
              data-testid={`backend-${b.value}`}
              type="button"
              size="sm"
              variant={value === b.value ? 'default' : 'outline'}
              aria-pressed={value === b.value}
              disabled={isUnsupported}
              onClick={() => onChange(b.value)}
              className={isUnsupported ? 'opacity-50' : ''}
            >
              {isUnsupported && <Ban className="mr-1 h-3 w-3" />}
              {b.name}
              {isRecommended && !isUnsupported && (
                <span className="ml-1 text-xs opacity-80">(recommended)</span>
              )}
            </Button>
          )

          if (!isUnsupported) return button
          return (
            <Tooltip key={b.value}>
              <TooltipTrigger asChild>
                <span className="inline-flex">{button}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Not available on {os ? getOSLabel(os) : 'this system'}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      {selectedBackend && (
        <p className="text-muted-foreground mt-1 text-xs">
          {selectedBackend.description}
        </p>
      )}
    </ConfigSection>
  )
}
