// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, Loader } from 'lucide-react'
import { useState } from 'react'
import { InfoTip } from '@/components/common/info-tip'
import { InlineNotice } from '@/components/common/inline-notice'
import { ConfigSection } from '@/components/configure/config-section'
import { Skeleton } from '@/components/ui/skeleton'
import { tasksFor } from '@/engines/multiserve/constants'
import { useModelManagerEngine } from '@/engines/multiserve/hooks/use-model-manager-engine'
import type {
  BackendId,
  ListedModel,
  ModelSelection,
} from '@/engines/multiserve/types'
import { getErrorMessage } from '@/lib/errors'
import type { ModelSource } from '@/types/common'
import { groupModels } from './group-models'
import { ModelCatalogStatus } from './model-catalog-status'
import { ModelList } from './model-list'
import { ModelManagerDialogs } from './model-manager-dialogs'
import { ModelManagerToolbar } from './model-manager-toolbar'
import { ModelRow } from './model-row'
import { ModelSearchInput } from './model-search-input'

interface ModelManagerProps {
  /** `type` or `type@instanceId` — the instance whose engine lists the models. */
  instanceKey: string
  dbId?: number
  backend?: BackendId
  onSelectModel: (selection: ModelSelection) => void
  selectedModel?: string
  /** The llama.cpp quant `selectedModel` runs as (`<repo>:<QUANT>`). */
  selectedQuant?: string
  /** The registry a picked or added model is pulled from (the drafted one). */
  source: ModelSource
  /**
   * A New-instance draft with no multiserve row to use (first instance, or moved from another
   * engine): health, the list, uploads and deletes go to the type's draft engine instead
   * (`draft-engine.ts`), started on demand by an upload or delete and stopped on unmount.
   */
  draftEngine?: boolean
}

/**
 * The Model section: the engine's models (searchable), plus Add, Upload and Delete. While the
 * engine is down it shows the disk scan; uploading or deleting starts the engine first.
 */
export function ModelManager({
  instanceKey,
  dbId,
  backend,
  onSelectModel,
  selectedModel,
  selectedQuant,
  source,
  draftEngine = false,
}: ModelManagerProps) {
  const {
    engineKey,
    engineUp,
    isWaitingForEngine,
    ensureEngine,
    showLive,
    listing,
    catalogScanError,
  } = useModelManagerEngine({ instanceKey, dbId, backend, draftEngine })

  const [search, setSearch] = useState('')
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)

  const { models, selectable, downloaded, available, pendingDownload } =
    groupModels(listing.data, {
      allowedTasks: tasksFor(instanceKey),
      search,
      selectedModel,
    })

  const store = backend === 'llamacpp' ? 'GGUF' : 'OpenVINO'
  const aboutModels = [
    'The model you pick is saved with the other settings.',
    `Adding, uploading or deleting a model changes the ${store} model store right away, for every instance of this service.`,
    !showLive &&
      'Showing models found on disk. Uploading or deleting a model starts the engine.',
  ]
    .filter(Boolean)
    .join(' ')

  const renderRow = (model: ListedModel) => (
    <ModelRow
      key={`${model.backend}-${model.repo_id}`}
      model={model}
      engineKey={engineKey}
      isSelected={selectedModel === model.repo_id}
      selectedQuant={selectedQuant}
      onSelect={onSelectModel}
      backend={backend}
      source={source}
      ensureEngine={ensureEngine}
    />
  )

  return (
    <ConfigSection
      data-testid="model-manager"
      data-catalog={showLive ? 'engine' : 'disk'}
      title={
        <>
          Model
          <InfoTip
            tooltip={aboutModels}
            ariaLabel="About the model list"
            size="sm"
            className="ml-1 inline-flex align-middle"
            contentClassName="max-w-xs text-xs"
          />
          {listing.isFetching && (
            <Loader
              aria-label="Refreshing models"
              className="text-muted-foreground ml-1.5 inline-block h-3 w-3 animate-spin"
            />
          )}
        </>
      }
      aside={
        <ModelManagerToolbar
          onAdd={() => setDownloadDialogOpen(true)}
          onUpload={() => setUploadDialogOpen(true)}
        />
      }
    >
      <ModelCatalogStatus
        isWaitingForEngine={isWaitingForEngine}
        showLive={showLive}
        scanError={catalogScanError}
      />

      {models.length === 0 && listing.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      ) : models.length === 0 && listing.isError ? (
        <InlineNotice
          tone="destructive"
          size="sm"
          icon={<AlertCircle className="h-3.5 w-3.5 shrink-0" />}
        >
          {getErrorMessage(listing.error, 'Failed to load models.')}
        </InlineNotice>
      ) : (
        <>
          {selectable.length > 0 && (
            <ModelSearchInput value={search} onChange={setSearch} />
          )}
          <ModelList
            downloaded={downloaded}
            available={available}
            pendingModel={pendingDownload ? selectedModel : undefined}
            search={search}
            renderRow={renderRow}
          />
        </>
      )}

      <ModelManagerDialogs
        instanceKey={instanceKey}
        backend={backend}
        engineKey={engineKey}
        engineUp={engineUp}
        ensureEngine={ensureEngine}
        source={source}
        existingModelIds={models
          .filter((m) => m.downloaded.length > 0)
          .map((m) => m.repo_id)}
        onSelectModel={onSelectModel}
        downloadOpen={downloadDialogOpen}
        onDownloadOpenChange={setDownloadDialogOpen}
        uploadOpen={uploadDialogOpen}
        onUploadOpenChange={setUploadDialogOpen}
      />
    </ConfigSection>
  )
}
