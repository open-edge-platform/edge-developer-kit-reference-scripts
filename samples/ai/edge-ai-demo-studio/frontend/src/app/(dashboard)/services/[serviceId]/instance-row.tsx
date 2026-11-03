// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { TruncatedText } from '@/components/common/truncated-text'
import {
  InstanceLifecycleButton,
  InstanceStatusLabel,
} from '@/components/services/instance-lifecycle'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  type InstanceTab,
  instanceRuntime,
} from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import type { ServiceInstance } from '@/services/types'
import { InstanceMeta } from './instance-meta'
import { InstanceMenu } from './instance-menu'

/** One instance in the Manage instances sheet. */
export function InstanceRow({
  instance,
  siblings,
  checked,
  onCheckedChange,
  isShown,
  onOpen,
  onDuplicated,
  onDeleted,
}: {
  instance: ServiceInstance
  siblings: ServiceInstance[]
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  isShown: boolean
  onOpen: (tab?: InstanceTab) => void
  onDuplicated: (instanceId: string) => void
  onDeleted: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { model, device } = instanceRuntime(instance)
  const isError = instance.status === 'error'

  return (
    <li
      className={cn(
        'px-5 py-3',
        isShown && 'bg-primary/[0.04]',
        isError && 'bg-destructive/[0.03]',
      )}
      data-testid={`instance-row-${instance.instanceId}`}
      data-shown={isShown || undefined}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 sm:flex-nowrap sm:items-center">
        <Checkbox
          className="mt-1 sm:mt-0"
          checked={checked}
          onCheckedChange={(state) => onCheckedChange(state === true)}
          aria-label={`Select ${instance.label}`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <button
              type="button"
              onClick={() => onOpen()}
              className="text-foreground hover:text-primary focus-visible:ring-ring/50 max-w-full truncate rounded-sm text-left text-sm font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]"
              aria-label={`Open ${instance.label}`}
              data-testid={`instance-open-${instance.instanceId}`}
            >
              {instance.label}
            </button>
            {isShown && (
              <Badge tone="primary" className="px-1.5 text-xs font-semibold">
                Shown
              </Badge>
            )}
          </div>
          {(model || device) && (
            <TruncatedText
              text={[model, device].filter(Boolean).join(' · ')}
              className="text-muted-foreground text-xs"
            />
          )}
        </div>

        <div className="flex w-full shrink-0 items-center gap-2 pl-7 sm:w-auto sm:pl-0">
          <InstanceStatusLabel
            instance={instance}
            className="mr-auto sm:mr-1 sm:w-24"
          />
          <InstanceLifecycleButton
            instance={instance}
            variant="row"
            testId={`instance-toggle-${instance.instanceId}`}
          />
          <InstanceMenu
            instance={instance}
            siblings={siblings}
            onDuplicated={onDuplicated}
            onDeleted={onDeleted}
            compact
          />
        </div>
      </div>

      {isError && (
        <p className="text-destructive mt-2 pl-7 text-xs">
          {instance.statusMessage ?? 'Failed to start.'}{' '}
          <button
            type="button"
            onClick={() => onOpen('logs')}
            className="font-medium underline underline-offset-2"
          >
            View logs
          </button>
        </p>
      )}

      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground mt-1.5 ml-7 flex items-center gap-1 rounded-sm text-xs">
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'h-3 w-3 transition-transform duration-150',
              expanded && 'rotate-90',
            )}
          />
          Details
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-1.5 pl-7">
          <InstanceMeta instance={instance} />
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}
