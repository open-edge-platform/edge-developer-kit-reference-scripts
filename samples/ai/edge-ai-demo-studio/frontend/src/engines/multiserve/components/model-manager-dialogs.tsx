// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { defaultTaskFor } from '@/engines/multiserve/constants'
import { useEngineUpload } from '@/engines/multiserve/hooks/use-engine-upload'
import type { BackendId, ModelSelection } from '@/engines/multiserve/types'
import type { ModelSource } from '@/types/common'
import { DownloadModelDialog } from './download-model-dialog'
import { UploadModelDialog } from './upload-model-dialog'

/** The model manager's Add and Upload dialogs; an upload starts the engine first if it is down. */
export function ModelManagerDialogs({
  instanceKey,
  backend,
  engineKey,
  engineUp,
  ensureEngine,
  source,
  existingModelIds,
  onSelectModel,
  downloadOpen,
  onDownloadOpenChange,
  uploadOpen,
  onUploadOpenChange,
}: {
  instanceKey: string
  backend?: BackendId
  engineKey: string
  engineUp: boolean
  ensureEngine: () => Promise<void>
  source: ModelSource
  existingModelIds: string[]
  onSelectModel: (selection: ModelSelection) => void
  downloadOpen: boolean
  onDownloadOpenChange: (open: boolean) => void
  uploadOpen: boolean
  onUploadOpenChange: (open: boolean) => void
}) {
  const {
    upload,
    cancel: cancelUpload,
    reset: resetUpload,
    progress: uploadProgress,
    isPending: isUploading,
    isSuccess: isUploadSuccess,
    error: uploadError,
    waitingForEngine: uploadWaitingForEngine,
  } = useEngineUpload(engineKey, { engineUp, ensureEngine })

  return (
    <>
      <DownloadModelDialog
        open={downloadOpen}
        onOpenChange={onDownloadOpenChange}
        instanceKey={instanceKey}
        backend={backend ?? 'openvino'}
        existingModelIds={existingModelIds}
        onDownload={(params) => {
          onSelectModel({
            repoId: params.repoId,
            backend: params.backend,
            taskType: params.task === 'multimodal' ? 'multimodal' : 'default',
            weightFormat: params.weightFormat,
            additionalParams: params.additionalParams,
            source,
          })
          onDownloadOpenChange(false)
        }}
      />

      <UploadModelDialog
        open={uploadOpen}
        onOpenChange={(open) => {
          onUploadOpenChange(open)
          // An upload in flight keeps going with the dialog closed; reopening
          // shows its progress again. A finished one leaves no stale notice.
          if (!open && !isUploading) resetUpload()
        }}
        backend={backend ?? 'openvino'}
        taskType={defaultTaskFor(instanceKey)}
        onUpload={(params) => upload(params, () => onUploadOpenChange(false))}
        onCancelUpload={cancelUpload}
        isUploading={isUploading || uploadWaitingForEngine}
        uploadProgress={uploadProgress}
        isUploadSuccess={isUploadSuccess}
        uploadError={uploadError}
        pendingMessage={
          uploadWaitingForEngine
            ? 'Starting the engine — the upload begins once it is up…'
            : undefined
        }
      />
    </>
  )
}
