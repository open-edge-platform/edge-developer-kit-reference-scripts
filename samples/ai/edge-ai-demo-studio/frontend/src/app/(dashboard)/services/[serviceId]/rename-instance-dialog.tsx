// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { InlineNotice } from '@/components/common/inline-notice'
import { TruncatedText } from '@/components/common/truncated-text'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  useDeploymentFileInUse,
  useRenameInstance,
} from '@/hooks/use-instances'
import {
  duplicateInstanceLabelMessage,
  findInstanceWithLabel,
} from '@/lib/instances/instances'
import { isRunningStatus, type ServiceInstance } from '@/services/types'

interface RenameProps {
  instance: ServiceInstance
  siblings: ServiceInstance[]
}

/**
 * Renames an instance's display name only. Its id is fixed, so the API address, settings, data,
 * bound samples and `?instance=` all stay, and a running instance keeps running.
 */
export function RenameInstanceDialog({
  open,
  onOpenChange,
  ...props
}: RenameProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        {/* Mounted only while open, so every open starts from the current name. */}
        <RenameForm {...props} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function RenameForm({
  instance,
  siblings,
  onClose,
}: RenameProps & { onClose: () => void }) {
  const [draftLabel, setDraftLabel] = useState(instance.label)
  const { mutate: rename, isPending } = useRenameInstance()
  const deploymentInUse = useDeploymentFileInUse(true)

  const otherInstances = siblings.filter(
    (s) => s.instanceKey !== instance.instanceKey,
  )
  const label = draftLabel.trim()
  const renameError = !label
    ? 'Give the instance a name.'
    : findInstanceWithLabel(label, otherInstances)
      ? duplicateInstanceLabelMessage(label)
      : undefined
  const running = isRunningStatus(instance.status)

  const submitRename = () => {
    if (renameError || isPending) return
    if (label === instance.label) {
      onClose()
      return
    }
    rename(
      { dbId: instance.dbId, label },
      {
        onSuccess: () => {
          toast.success(`Renamed to “${label}”`)
          onClose()
        },
      },
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename instance</DialogTitle>
        <DialogDescription>
          Only the display name changes. The API address, settings and data stay
          the same{running ? ', and the instance keeps running' : ''}.
        </DialogDescription>
      </DialogHeader>
      <Input
        autoFocus
        value={draftLabel}
        onChange={(e) => setDraftLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitRename()
        }}
        placeholder="Instance name"
        aria-label="Instance name"
        aria-invalid={Boolean(renameError)}
        aria-describedby={renameError ? 'rename-instance-error' : undefined}
        data-testid="rename-instance-input"
      />
      {renameError && (
        <p
          id="rename-instance-error"
          data-testid="rename-instance-error"
          className="text-destructive -mt-2 text-xs font-medium"
        >
          {renameError}
        </p>
      )}
      {/* min-w-0: a long address must truncate, not widen the dialog grid. */}
      <div className="bg-muted/40 min-w-0 space-y-1 rounded-md border px-3 py-2.5 text-xs">
        <p className="text-muted-foreground">API address · stays the same</p>
        <TruncatedText
          text={instance.apiBase}
          className="text-foreground font-mono"
          data-testid="rename-instance-address"
        />
      </div>
      {/* deployment.json is the whole setup: it would put its own name back
          (or, without an id, replace the instance) on the next start. */}
      {deploymentInUse && (
        <InlineNotice
          tone="info"
          role={null}
          data-testid="rename-deployment-note"
        >
          This app starts from a deployment.json, so the new name lasts until
          the next start. To keep it, save the deployment again in{' '}
          <Link
            href="/settings"
            className="font-medium underline underline-offset-2"
          >
            Settings
          </Link>
          .
        </InlineNotice>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={Boolean(renameError) || isPending}
          onClick={submitRename}
          data-testid="rename-instance-save"
        >
          {isPending && <Loader className="h-3.5 w-3.5 animate-spin" />}
          Save name
        </Button>
      </DialogFooter>
    </>
  )
}
