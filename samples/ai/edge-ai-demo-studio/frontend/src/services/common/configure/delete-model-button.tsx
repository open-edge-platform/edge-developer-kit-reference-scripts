// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import { useDeleteDownloadedModel } from '@/hooks/use-delete-downloaded-model'
import { formatBytes } from '@/lib/browser/format'
import type { WorkerCatalogModel } from '@/lib/workers/model-catalog'

/**
 * Deletes one downloaded model of a worker service: a trash button that
 * asks first, naming what goes (its files and their size), and keeps the
 * confirmation open until the delete has settled, so a refusal (an instance
 * running the model) shows there. Runtime Settings' Downloaded models and
 * the Overview of a service nobody added both use it.
 */
export function DeleteModelButton({
  type,
  instanceKey,
  model,
  label,
  serviceName,
  disabled = false,
  note,
}: {
  /** The service type. */
  type: string
  /** The instance asking, when there is one. */
  instanceKey?: string
  /** The catalogue entry, with its `files` and `size`. */
  model: WorkerCatalogModel
  label: string
  serviceName: string
  disabled?: boolean
  /** Said last in the confirmation, e.g. what the delete leaves alone. */
  note?: string
}) {
  const { mutateAsync: deleteModel, isPending } = useDeleteDownloadedModel()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive h-7 w-7 shrink-0"
        aria-label={`Delete ${label}`}
        disabled={disabled || isPending}
        onClick={() => setOpen(true)}
        data-testid="delete-downloaded-model"
      >
        {isPending ? (
          <Loader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
        )}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        variant="destructive"
        title={`Delete ${label}?`}
        description={
          <>
            Removes its files from disk right away
            {model.size ? ` (${formatBytes(model.size)})` : ''}. {serviceName}{' '}
            downloads it again the next time an instance starts with it.
            {note && ` ${note}`}
          </>
        }
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        confirmTestId="delete-downloaded-model-confirm"
        onConfirm={() =>
          deleteModel({ type, instanceKey, model: model.name, label })
        }
      >
        {model.files && model.files.length > 0 && (
          <ul
            className="bg-muted text-muted-foreground max-h-32 space-y-0.5 overflow-auto rounded-md p-2 font-mono text-xs"
            data-testid="delete-downloaded-model-files"
          >
            {model.files.map((file) => (
              <li key={file} className="break-all">
                {file}
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
    </>
  )
}
