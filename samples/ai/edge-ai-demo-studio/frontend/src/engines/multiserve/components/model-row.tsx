// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Eye, HardDrive, Loader, ShieldCheck, Trash2 } from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useDeleteModel } from '@/engines/multiserve/hooks/use-models'
import {
  joinModelName,
  quantDeleteTarget,
  quantForRowClick,
  rowSelection,
} from '@/engines/multiserve/quant-selection'
import type {
  BackendId,
  ListedModel,
  ModelSelection,
} from '@/engines/multiserve/types'
import { cn } from '@/lib/utils'
import type { ModelSource } from '@/types/common'
import { QuantBadges } from './quant-badges'

const BADGE = 'h-4 px-1 py-0 text-[10px]'

/** Downloaded / Verified / Vision: what a row's model is. */
function ModelStatusBadges({ model }: { model: ListedModel }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {model.downloaded.length > 0 ? (
        <Badge tone="success" className={BADGE}>
          <HardDrive aria-hidden="true" className="mr-0.5 h-2.5 w-2.5" />
          Downloaded
        </Badge>
      ) : (
        <Badge variant="outline" className={cn(BADGE, 'text-muted-foreground')}>
          Not downloaded
        </Badge>
      )}
      {model.verified.length > 0 && (
        <Badge tone="info" className={BADGE}>
          <ShieldCheck aria-hidden="true" className="mr-0.5 h-2.5 w-2.5" />
          Verified
        </Badge>
      )}
      {model.task_type === 'multimodal' && (
        <Badge tone="primary" className={BADGE}>
          <Eye aria-hidden="true" className="mr-0.5 h-2.5 w-2.5" />
          Vision
        </Badge>
      )}
    </span>
  )
}

/**
 * A model list row: select button, quant badges and delete, side by side (none nested). The delete
 * dialog stays open while the engine starts and the model is removed.
 */
export function ModelRow({
  model,
  engineKey,
  isSelected,
  selectedQuant,
  onSelect,
  backend,
  source,
  ensureEngine,
}: {
  model: ListedModel
  /** The engine address deletes go to. */
  engineKey: string
  isSelected: boolean
  /** The quant the selection runs as, when this row is the selected one. */
  selectedQuant?: string
  onSelect: (selection: ModelSelection) => void
  backend?: BackendId
  source?: ModelSource
  /** Resolves once the engine is up (starting it if needed); rejects, already reported, if not. */
  ensureEngine: () => Promise<void>
}) {
  const isDownloaded = model.downloaded.length > 0

  // A llama.cpp row runs as `<repo>:<QUANT>`, so its quants are pickable;
  // an OpenVINO row's quant labels describe the one folder it has.
  const quantsPickable = (backend ?? model.backend) === 'llamacpp'
  const chosenQuant = isSelected && quantsPickable ? selectedQuant : undefined
  const deletableQuant = quantsPickable
    ? quantDeleteTarget(model, chosenQuant)
    : undefined

  const {
    mutate: deleteModel,
    isPending: isDeleting,
    variables: deleting,
  } = useDeleteModel(engineKey)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [waitingForEngine, setWaitingForEngine] = useState(false)
  const busy = isDeleting || waitingForEngine

  const select = (quant: string | undefined) =>
    onSelect(rowSelection(model, { backend, quant, source }))

  // The action would close the dialog at once; it closes when the delete
  // has settled instead, showing the engine start and the delete meanwhile.
  const handleDelete = (e: MouseEvent, quant?: string) => {
    e.preventDefault()
    setWaitingForEngine(true)
    ensureEngine()
      .then(
        () =>
          deleteModel(
            {
              backend: model.backend,
              repoId: joinModelName(model.repo_id, quant),
            },
            { onSettled: () => setConfirmOpen(false) },
          ),
        () => setConfirmOpen(false),
      )
      .finally(() => setWaitingForEngine(false))
  }

  return (
    <li
      data-testid="model-row"
      aria-busy={busy || undefined}
      className={cn(
        'flex w-full items-start gap-2 rounded-md border p-2 text-xs transition-all',
        busy && 'opacity-50',
        isSelected
          ? 'border-primary bg-primary/5 ring-primary/20 ring-1'
          : 'bg-card hover:bg-accent/50',
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <button
          type="button"
          data-testid="model-option"
          aria-pressed={isSelected}
          disabled={busy}
          onClick={() => select(quantForRowClick(model, chosenQuant))}
          title={model.repo_id}
          className="focus-visible:ring-ring/50 block w-full space-y-1 rounded-sm text-left outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed"
        >
          <span className="block truncate font-medium">{model.repo_id}</span>
          <ModelStatusBadges model={model} />
        </button>
        <QuantBadges
          model={model}
          activeQuant={chosenQuant}
          onPick={quantsPickable ? select : undefined}
          disabled={busy}
        />
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid="delete-model-button"
            variant="ghost"
            size="icon"
            aria-label={`Delete ${model.repo_id}`}
            className="text-muted-foreground hover:text-destructive h-6 w-6 shrink-0"
            disabled={!isDownloaded || busy}
            onClick={() => setConfirmOpen(true)}
          >
            {busy ? (
              <Loader className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {waitingForEngine
            ? 'Starting the engine to delete this model…'
            : isDownloaded
              ? 'Delete model from disk'
              : 'Model not downloaded'}
        </TooltipContent>
      </Tooltip>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!busy) setConfirmOpen(open)
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {waitingForEngine
                ? 'Starting engine…'
                : isDeleting
                  ? 'Deleting Model…'
                  : 'Delete Model'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {waitingForEngine ? (
                <span className="flex items-center gap-2">
                  <Loader className="h-3.5 w-3.5 animate-spin" />
                  The model is deleted as soon as the engine is up.
                </span>
              ) : isDeleting ? (
                <span className="flex items-center gap-2">
                  <Loader className="h-3.5 w-3.5 animate-spin" />
                  Removing{' '}
                  <span className="text-foreground font-medium">
                    {deleting?.repoId ?? model.repo_id}
                  </span>{' '}
                  from disk…
                </span>
              ) : deletableQuant ? (
                <>
                  Delete only{' '}
                  <span className="text-foreground font-medium">
                    {joinModelName(model.repo_id, deletableQuant)}
                  </span>
                  , or all {model.downloaded.length} downloaded quantizations of{' '}
                  <span className="text-foreground font-medium">
                    {model.repo_id}
                  </span>
                  ? This will remove the model files from disk.
                </>
              ) : (
                <>
                  Are you sure you want to delete{' '}
                  <span className="text-foreground font-medium">
                    {model.repo_id}
                  </span>
                  ? This will remove the model files from disk.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-sm" disabled={busy}>
              Cancel
            </AlertDialogCancel>
            {deletableQuant && !busy && (
              <AlertDialogAction
                data-testid="delete-model-quant-confirm"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                onClick={(e) => handleDelete(e, deletableQuant)}
              >
                Delete {deletableQuant}
              </AlertDialogAction>
            )}
            <AlertDialogAction
              data-testid="delete-model-confirm"
              className={buttonVariants({ variant: 'destructive', size: 'sm' })}
              onClick={(e) => handleDelete(e)}
              disabled={busy}
              aria-busy={busy || undefined}
            >
              {busy ? (
                <>
                  <Loader className="mr-1 h-3.5 w-3.5 animate-spin" />
                  Deleting…
                </>
              ) : deletableQuant ? (
                'Delete all'
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
