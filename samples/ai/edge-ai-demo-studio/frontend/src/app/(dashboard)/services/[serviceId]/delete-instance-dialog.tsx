// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { useDeleteInstance } from '@/hooks/use-instances'
import { useSessionBusyInstances } from '@/services/common/demo/session-store'
import { isRunningStatus, type ServiceInstance } from '@/services/types'

/**
 * Confirms deleting an instance, listing what goes (settings, `INSTANCE_DATA_DIR`) and what stays
 * (shared models). Deleting the last instance takes the service back to Not added.
 */
export function DeleteInstanceDialog({
  instance,
  siblings,
  open,
  onOpenChange,
  onDeleted,
}: {
  instance: ServiceInstance
  siblings: ServiceInstance[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}) {
  const { mutateAsync: remove } = useDeleteInstance()
  const busy = useSessionBusyInstances().has(instance.instanceKey)
  const removesService = siblings.length === 1
  const running = isRunningStatus(instance.status)

  const confirm = async () => {
    await remove(instance.dbId)
    toast.success(
      removesService
        ? `${instance.name} removed`
        : `Instance “${instance.label}” deleted`,
    )
    onDeleted?.()
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      variant="destructive"
      title={
        removesService
          ? `Remove ${instance.name}?`
          : `Delete “${instance.label}”?`
      }
      description={
        removesService
          ? `This is the last instance of ${instance.name}.`
          : 'This cannot be undone.'
      }
      confirmLabel={removesService ? 'Remove service' : 'Delete instance'}
      pendingLabel={removesService ? 'Removing…' : 'Deleting…'}
      onConfirm={confirm}
    >
      <div className="text-muted-foreground space-y-2 text-sm">
        <ul className="list-disc space-y-1 pl-4">
          {running && <li>It stops now.</li>}
          <li>
            Its API URL{' '}
            <code className="font-mono text-xs break-all">
              {instance.apiBase}
            </code>{' '}
            stops answering.
          </li>
          <li>
            Its settings are deleted
            {removesService
              ? ' — adding the service again starts from the recommended setup.'
              : '.'}
          </li>
          <li>Anything it saved in its own data folder is deleted too.</li>
          <li>
            Downloaded models are kept: they are shared with{' '}
            {removesService
              ? 'any instance you add later'
              : 'the other instances'}
            .
          </li>
          {removesService && (
            <li>
              {instance.name} leaves the sidebar and shows as Not added in
              Services.
            </li>
          )}
        </ul>
        {busy && (
          <p className="text-warning" data-testid="delete-busy-warning">
            “{instance.label}” is still producing a result in the demo; deleting
            it cuts that off.
          </p>
        )}
      </div>
    </ConfirmDialog>
  )
}
