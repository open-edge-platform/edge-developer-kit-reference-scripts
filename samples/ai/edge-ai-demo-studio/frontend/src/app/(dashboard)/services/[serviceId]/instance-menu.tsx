// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Copy,
  Ellipsis,
  Layers,
  Link2,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { NewInstanceSheet } from '@/components/services/new-instance-sheet'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  useServiceActivity,
  useServiceStatus,
} from '@/context/service-status-context'
import { useInterruptionGuard } from '@/components/services/instance-lifecycle'
import { copyApiUrl } from '@/lib/browser/copy-api-url'
import { addInstanceAvailability } from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import type { ServiceInstance } from '@/services/types'
import { DeleteInstanceDialog } from './delete-instance-dialog'
import { RenameInstanceDialog } from './rename-instance-dialog'

/** An instance's ⋯ menu of secondary actions. */
export function InstanceMenu({
  instance,
  siblings,
  onDuplicated,
  onDeleted,
  onManage,
  compact = false,
}: {
  instance: ServiceInstance
  siblings: ServiceInstance[]
  /** Called with the new instance's id once Duplicate has created it. */
  onDuplicated: (instanceId: string) => void
  onDeleted?: () => void
  /** Adds "Manage instances…", which opens the instance manager. */
  onManage?: () => void
  /** Borderless trigger, for rows inside the instance manager. */
  compact?: boolean
}) {
  const { restartService } = useServiceStatus()
  const { isActionPending } = useServiceActivity()
  const { guard, dialog } = useInterruptionGuard()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [duplicating, setDuplicating] = useState(false)

  const removesService = siblings.length === 1
  const canDuplicate = addInstanceAvailability({
    multiInstance: instance.multiInstance,
    maxInstances: instance.maxInstances,
    instances: siblings,
  })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={compact ? 'ghost' : 'outline'}
            size="icon-sm"
            aria-label={`More actions for ${instance.label}`}
            className={cn(compact && 'text-muted-foreground')}
            data-testid={`instance-menu-${instance.instanceId}`}
          >
            <Ellipsis className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="min-w-[224px]">
          {instance.status === 'online' && (
            <DropdownMenuItem
              disabled={isActionPending(instance.instanceKey)}
              // A failure is already reported as a toast.
              onSelect={() =>
                guard([instance], 'restart', () => {
                  restartService(instance.instanceKey).catch(() => {})
                })
              }
              data-testid={`instance-restart-${instance.instanceId}`}
            >
              <RotateCcw />
              Restart
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canDuplicate.allowed}
            onSelect={() => setDuplicating(true)}
          >
            <Copy />
            <span className="flex flex-col">
              Duplicate
              {!canDuplicate.allowed && (
                <span className="text-muted-foreground text-xs">
                  {canDuplicate.reason}
                </span>
              )}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copyApiUrl(instance.apiBase)}>
            <Link2 />
            Copy API URL
          </DropdownMenuItem>
          {onManage && (
            <DropdownMenuItem
              onSelect={onManage}
              data-testid="manage-instances-menu-item"
            >
              <Layers />
              Manage instances…
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleting(true)}
            data-testid={`instance-delete-${instance.instanceId}`}
          >
            <Trash2 />
            {removesService ? 'Remove service' : 'Delete instance'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameInstanceDialog
        instance={instance}
        siblings={siblings}
        open={renaming}
        onOpenChange={setRenaming}
      />

      <DeleteInstanceDialog
        instance={instance}
        siblings={siblings}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={onDeleted}
      />

      {dialog}

      <NewInstanceSheet
        serviceType={instance.id}
        open={duplicating}
        onOpenChange={setDuplicating}
        copyFromInstanceId={instance.instanceId}
        onCreated={(doc) => onDuplicated(doc.instanceId)}
        hideTrigger
      />
    </>
  )
}
