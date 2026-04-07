// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Loader2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
  EmbeddingSettings,
  InferenceEngine,
  Model,
  ModelList,
} from '@/types/workload'
import { Workload } from '@/payload-types'
import { getModelNameWithQuant } from '@/utils/common'
import { EngineSelector } from '@/components/common/engine-selector'
import { EMBEDDING_TYPE, RERANKER_TYPE } from '@/lib/workloads/embedding'
import {
  useDeleteWorkloadModel,
  useGetWorkloadModels,
} from '@/hooks/use-workload'
import { ConfirmationDialog } from '@/components/common/confirmation-dialog'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { WorkloadModelConfiguration } from '@/components/common/multiserve/multiserve-model-configuration'
import { CurrentSelectionBadge } from '@/components/common/model-selector'

interface EmbeddingSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  currentSettings: EmbeddingSettings
  engines: InferenceEngine[]
  updateSettings: (settings: EmbeddingSettings) => Promise<unknown>
}

export function EmbeddingSettingsModal({
  isOpen,
  onClose,
  currentSettings: {
    embeddingModel: selectedEmbeddingModel,
    rerankerModel: selectedRerankerModel,
    engine: selectedEngine,
  },
  engines,
  updateSettings,
}: EmbeddingSettingsModalProps) {
  const getModelName = useCallback(
    (type: 'embedding' | 'reranker') => {
      return getModelNameWithQuant(
        type === 'embedding' ? selectedEmbeddingModel : selectedRerankerModel,
        selectedEngine,
      )
    },
    [selectedEngine, selectedEmbeddingModel, selectedRerankerModel],
  )

  const [tempEngine, setTempEngine] = useState<Workload['engine']>(
    selectedEngine || 'openvino',
  )

  // Fetch models
  const { data: embeddingModelsList, isLoading: isEmbeddingLoading } =
    useGetWorkloadModels(EMBEDDING_TYPE, tempEngine)
  const { data: rerankerModelsList, isLoading: isRerankerLoading } =
    useGetWorkloadModels(RERANKER_TYPE, tempEngine)

  const { mutate: deleteModel, isPending: isDeleting } =
    useDeleteWorkloadModel()
  const [modelToDelete, setModelToDelete] = useState<{
    id: string
    type: Workload['type'] | 'rerank'
  } | null>(null)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)

  // Embedding state
  const [tempEmbeddingModelOverride, setTempEmbeddingModelOverride] = useState<
    string | null
  >(null)
  const [tempEmbeddingDevice, setTempEmbeddingDevice] = useState(
    selectedEmbeddingModel?.device || 'CPU',
  )
  const [tempEmbeddingParams, setTempEmbeddingParams] = useState(
    selectedEmbeddingModel?.params || '',
  )
  const [embeddingTabValue, setEmbeddingTabValue] = useState<string | null>(
    null,
  )
  const [isEmbeddingValid, setIsEmbeddingValid] = useState(true)
  const [embeddingSource, setEmbeddingSource] = useState<
    'huggingface' | 'modelscope' | 'custom'
  >(selectedEmbeddingModel?.source ?? 'huggingface')

  // Reranker state
  const [tempRerankerModelOverride, setTempRerankerModelOverride] = useState<
    string | null
  >(null)
  const [tempRerankerDevice, setTempRerankerDevice] = useState(
    selectedRerankerModel?.device || 'CPU',
  )
  const [tempRerankerParams, setTempRerankerParams] = useState(
    selectedRerankerModel?.params || '',
  )
  const [rerankerTabValue, setRerankerTabValue] = useState<string | null>(null)
  const [isRerankerValid, setIsRerankerValid] = useState(true)
  const [rerankerSource, setRerankerSource] = useState<
    'huggingface' | 'modelscope' | 'custom'
  >(selectedRerankerModel?.source ?? 'huggingface')

  const [isLoading, setIsLoading] = useState(false)

  // Temp file paths (unused in final logic but needed for state)
  const [tempEmbeddingLocalFilePath, setTempEmbeddingLocalFilePath] =
    useState('')
  const [tempRerankerLocalFilePath, setTempRerankerLocalFilePath] = useState('')

  const derivedEmbeddingModels = useMemo(() => {
    const verified: ModelList = []
    const custom: ModelList = []

    if (embeddingModelsList) {
      embeddingModelsList.forEach((m) => {
        if (m.verified) verified.push(m)
        else custom.push(m)
      })
    }

    return { verified, custom }
  }, [embeddingModelsList])

  const derivedRerankerModels = useMemo(() => {
    const verified: ModelList = []
    const custom: ModelList = []

    if (rerankerModelsList) {
      rerankerModelsList.forEach((m) => {
        if (m.verified) verified.push(m)
        else custom.push(m)
      })
    }

    return { verified, custom }
  }, [rerankerModelsList])

  const verifiedEmbedding = useMemo(() => {
    return tempEngine ? derivedEmbeddingModels.verified : []
  }, [derivedEmbeddingModels.verified, tempEngine])

  const customEmbedding = useMemo(() => {
    return tempEngine ? derivedEmbeddingModels.custom : []
  }, [derivedEmbeddingModels.custom, tempEngine])

  const verifiedReranker = useMemo(() => {
    return tempEngine ? derivedRerankerModels.verified : []
  }, [derivedRerankerModels.verified, tempEngine])

  const customReranker = useMemo(() => {
    return tempEngine ? derivedRerankerModels.custom : []
  }, [derivedRerankerModels.custom, tempEngine])

  const embeddingSavedModelType = useMemo(() => {
    if (tempEngine !== selectedEngine) return 'verified'
    const name = getModelName('embedding')
    const isCustomModel = !verifiedEmbedding.some((model) => model.id === name)
    return isCustomModel ? 'custom' : 'verified'
  }, [getModelName, verifiedEmbedding, tempEngine, selectedEngine])

  const rerankerSavedModelType = useMemo(() => {
    if (tempEngine !== selectedEngine) return 'verified'
    const name = getModelName('reranker')
    const isCustomModel = !verifiedReranker.some((model) => model.id === name)
    return isCustomModel ? 'custom' : 'verified'
  }, [getModelName, verifiedReranker, tempEngine, selectedEngine])

  const resolvedEmbeddingTabValue = useMemo(() => {
    if (embeddingTabValue) return embeddingTabValue
    return embeddingSavedModelType === 'custom' ? 'custom' : 'predefined'
  }, [embeddingSavedModelType, embeddingTabValue])

  const resolvedRerankerTabValue = useMemo(() => {
    if (rerankerTabValue) return rerankerTabValue
    return rerankerSavedModelType === 'custom' ? 'custom' : 'predefined'
  }, [rerankerSavedModelType, rerankerTabValue])

  const resolvedTempEmbeddingModel = useMemo(() => {
    if (tempEmbeddingModelOverride !== null) return tempEmbeddingModelOverride
    if (tempEngine !== selectedEngine) return verifiedEmbedding[0]?.id || ''
    if (embeddingSavedModelType === 'custom')
      return getModelName('embedding') || ''
    return getModelName('embedding') || verifiedEmbedding[0]?.id || ''
  }, [
    embeddingSavedModelType,
    getModelName,
    tempEmbeddingModelOverride,
    verifiedEmbedding,
    tempEngine,
    selectedEngine,
  ])

  const resolvedTempRerankerModel = useMemo(() => {
    if (tempRerankerModelOverride !== null) return tempRerankerModelOverride
    if (tempEngine !== selectedEngine) return verifiedReranker[0]?.id || ''
    if (rerankerSavedModelType === 'custom')
      return getModelName('reranker') || ''
    return getModelName('reranker') || verifiedReranker[0]?.id || ''
  }, [
    getModelName,
    rerankerSavedModelType,
    tempRerankerModelOverride,
    verifiedReranker,
    tempEngine,
    selectedEngine,
  ])

  // Handlers
  const handleEngineSelect = (value: Workload['engine']) => {
    setTempEngine(value)
    // Devices reset to CPU handled by state init if needed, or user selecting
    setTempEmbeddingDevice('CPU')
    setTempRerankerDevice('CPU')
    setTempEmbeddingModelOverride(null)
    setTempRerankerModelOverride(null)
    setEmbeddingTabValue(null)
    setRerankerTabValue(null)
  }

  const handleDeleteModel = async (
    id: string,
    type: Workload['type'] | 'rerank',
    e: React.MouseEvent,
  ) => {
    e.stopPropagation()
    setModelToDelete({ id, type })
    setIsDeleteConfirmOpen(true)
  }

  const confirmDeleteModel = () => {
    if (modelToDelete) {
      deleteModel(
        {
          engine: tempEngine,
          type: modelToDelete.type as Workload['type'],
          name: modelToDelete.id,
        },
        {
          onSuccess: () => {
            setIsDeleteConfirmOpen(false)
            if (
              modelToDelete.type === EMBEDDING_TYPE &&
              resolvedTempEmbeddingModel === modelToDelete.id
            ) {
              setTempEmbeddingModelOverride('')
            }
            if (
              modelToDelete.type === RERANKER_TYPE &&
              resolvedTempRerankerModel === modelToDelete.id
            ) {
              setTempRerankerModelOverride('')
            }
            setModelToDelete(null)
          },
        },
      )
    }
  }

  const validateModelName = (
    name: string,
    type: 'embedding' | 'reranker',
    tab: string,
    source: string,
  ) => {
    const verified = type === 'embedding' ? verifiedEmbedding : verifiedReranker
    const custom = type === 'embedding' ? customEmbedding : customReranker
    const selectedName = getModelName(type)

    if (name.trim() === '') return false

    if (tab === 'custom') {
      if (
        source === 'custom' &&
        !custom.find((m) => m.id === name)?.downloaded &&
        [...verified, ...custom].some(
          (m) => m.id === name && m.id !== selectedName,
        )
      ) {
        toast.error(`${type} model name already exists.`)
        return false
      }
    }
    return true
  }

  const handleSave = () => {
    if (
      !validateModelName(
        resolvedTempEmbeddingModel,
        'embedding',
        resolvedEmbeddingTabValue,
        embeddingSource,
      ) ||
      !validateModelName(
        resolvedTempRerankerModel,
        'reranker',
        resolvedRerankerTabValue,
        rerankerSource,
      )
    ) {
      return
    }

    // Embedding Model Construction
    let embeddingModel: Model = {
      name: resolvedTempEmbeddingModel,
      source: embeddingSource,
      device: tempEmbeddingDevice,
      params: tempEmbeddingParams,
    }

    if (resolvedEmbeddingTabValue !== 'custom') {
      const selected = verifiedEmbedding.find(
        (m) => m.id === resolvedTempEmbeddingModel,
      )
      if (selected) {
        let id = { ...selected }.id
        const colonIndex = id.indexOf(':')
        if (colonIndex !== -1) {
          id = id.substring(0, colonIndex)
        }
        embeddingModel = {
          name: id,
          quant: selected.quant,
          device: tempEmbeddingDevice,
          source: embeddingSource,
          params: tempEmbeddingParams,
        }
      }
    } else {
      const colonIndex = resolvedTempEmbeddingModel.indexOf(':')
      if (colonIndex !== -1) {
        embeddingModel = {
          name: resolvedTempEmbeddingModel.substring(0, colonIndex),
          quant: resolvedTempEmbeddingModel.substring(colonIndex + 1),
          source: embeddingSource,
          device: tempEmbeddingDevice,
          params: tempEmbeddingParams,
        }
      }
    }

    // Reranker Model Construction
    let rerankerModel: Model = {
      name: resolvedTempRerankerModel,
      source: rerankerSource,
      device: tempRerankerDevice,
      params: tempRerankerParams,
    }

    if (resolvedRerankerTabValue !== 'custom') {
      const selected = verifiedReranker.find(
        (m) => m.id === resolvedTempRerankerModel,
      )
      if (selected) {
        let id = { ...selected }.id
        const colonIndex = id.indexOf(':')
        if (colonIndex !== -1) {
          id = id.substring(0, colonIndex)
        }
        rerankerModel = {
          name: id,
          quant: selected.quant,
          device: tempRerankerDevice,
          source: rerankerSource,
          params: tempRerankerParams,
        }
      }
    } else {
      const colonIndex = resolvedTempRerankerModel.indexOf(':')
      if (colonIndex !== -1) {
        rerankerModel = {
          name: resolvedTempRerankerModel.substring(0, colonIndex),
          quant: resolvedTempRerankerModel.substring(colonIndex + 1),
          source: rerankerSource,
          device: tempRerankerDevice,
          params: tempRerankerParams,
        }
      }
    }

    setIsLoading(true)
    updateSettings({
      embeddingModel,
      rerankerModel,
      engine: tempEngine,
    })
      .then(() => {
        setIsLoading(false)
        onClose()
      })
      .catch(() => {
        setIsLoading(false)
      })
  }

  const canSave = useMemo(() => {
    // Embedding Check
    const isEmbeddingReady = (() => {
      if (!tempEmbeddingDevice) return false
      if (!tempEngine) return false
      if (
        !resolvedTempEmbeddingModel ||
        resolvedTempEmbeddingModel.trim().length === 0
      )
        return false

      if (resolvedEmbeddingTabValue === 'custom') {
        if (embeddingSource === 'custom') {
          return (
            !!resolvedTempEmbeddingModel &&
            resolvedTempEmbeddingModel.trim().length > 0 &&
            (!!tempEmbeddingLocalFilePath ||
              !!customEmbedding.find((m) => m.id === resolvedTempEmbeddingModel)
                ?.downloaded)
          )
        }
        return (
          !!resolvedTempEmbeddingModel &&
          resolvedTempEmbeddingModel.trim().length > 0 &&
          isEmbeddingValid
        )
      } else {
        if (
          resolvedTempEmbeddingModel.trim() === '' ||
          !verifiedEmbedding.find((m) => m.id === resolvedTempEmbeddingModel)
        ) {
          return false
        }
      }
      return true
    })()

    // Reranker Check
    const isRerankerReady = (() => {
      if (!tempRerankerDevice) return false
      if (!tempEngine) return false
      if (
        !resolvedTempRerankerModel ||
        resolvedTempRerankerModel.trim().length === 0
      )
        return false

      if (resolvedRerankerTabValue === 'custom') {
        if (rerankerSource === 'custom') {
          return (
            !!resolvedTempRerankerModel &&
            resolvedTempRerankerModel.trim().length > 0 &&
            (!!tempRerankerLocalFilePath ||
              !!customReranker.find((m) => m.id === resolvedTempRerankerModel)
                ?.downloaded)
          )
        }
        return (
          !!resolvedTempRerankerModel &&
          resolvedTempRerankerModel.trim().length > 0 &&
          isRerankerValid
        )
      } else {
        if (
          resolvedTempRerankerModel.trim() === '' ||
          !verifiedReranker.find((m) => m.id === resolvedTempRerankerModel)
        ) {
          return false
        }
      }
      return true
    })()

    return isEmbeddingReady && isRerankerReady
  }, [
    customEmbedding,
    customReranker,
    embeddingSource,
    resolvedEmbeddingTabValue,
    isEmbeddingValid,
    isRerankerValid,
    rerankerSource,
    resolvedRerankerTabValue,
    tempEmbeddingDevice,
    tempEmbeddingLocalFilePath,
    resolvedTempEmbeddingModel,
    tempEngine,
    tempRerankerDevice,
    tempRerankerLocalFilePath,
    resolvedTempRerankerModel,
    verifiedEmbedding,
    verifiedReranker,
  ])

  const resetState = () => {
    setTempEngine(selectedEngine || 'openvino')
    setTempEmbeddingDevice(selectedEmbeddingModel?.device || 'CPU')
    setTempEmbeddingParams(selectedEmbeddingModel?.params || '')
    setEmbeddingSource(selectedEmbeddingModel?.source ?? 'huggingface')
    setTempRerankerDevice(selectedRerankerModel?.device || 'CPU')
    setTempRerankerParams(selectedRerankerModel?.params || '')
    setRerankerSource(selectedRerankerModel?.source ?? 'huggingface')
    setTempEmbeddingLocalFilePath('')
    setTempRerankerLocalFilePath('')
    setIsEmbeddingValid(true)
    setIsRerankerValid(true)
    setEmbeddingTabValue(null)
    setRerankerTabValue(null)
    setTempEmbeddingModelOverride(null)
    setTempRerankerModelOverride(null)
  }

  const handleCancel = () => {
    resetState()
    onClose()
  }

  const handleDialogChange = (open: boolean) => {
    if (!open) {
      resetState()
      onClose()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogChange}>
      <DialogContent
        data-testid="embedding-settings-dialog"
        className="flex max-h-[90vh] flex-col sm:max-w-[700px]"
      >
        <DialogHeader>
          <DialogTitle className="text-xl">
            Embedding Service Settings
          </DialogTitle>
          {selectedEmbeddingModel && selectedRerankerModel && (
            <div className="space-y-1.5 pt-3 text-sm">
              <CurrentSelectionBadge
                label="Embedding"
                modelName={getModelName('embedding')}
                modelType={embeddingSavedModelType}
                engine={selectedEngine}
              />
              <CurrentSelectionBadge
                label="Reranker"
                modelName={getModelName('reranker')}
                modelType={rerankerSavedModelType}
                engine={selectedEngine}
              />
            </div>
          )}
        </DialogHeader>

        {isEmbeddingLoading || isRerankerLoading ? (
          <div className="flex min-h-0 w-full flex-1 flex-col space-y-4">
            <Skeleton className="h-10 w-full rounded-md" />

            <div className="space-y-2 pt-2">
              <Skeleton className="h-5 w-[120px]" />
              <Skeleton className="h-10 w-full" />
            </div>

            <div className="space-y-2">
              <Skeleton className="h-5 w-[100px]" />
              <Skeleton className="h-10 w-full" />
            </div>

            <div className="space-y-2">
              <Skeleton className="h-5 w-[100px]" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-6 overflow-y-auto pr-2">
            <EngineSelector
              value={tempEngine}
              onChange={handleEngineSelect}
              engines={engines}
            />

            <WorkloadModelConfiguration
              title="Embedding Model"
              task={EMBEDDING_TYPE}
              modelType={EMBEDDING_TYPE}
              engine={tempEngine}
              verifiedModels={verifiedEmbedding}
              customModels={customEmbedding}
              selectedModel={resolvedTempEmbeddingModel}
              onModelSelect={setTempEmbeddingModelOverride}
              tabValue={resolvedEmbeddingTabValue}
              onTabChange={setEmbeddingTabValue}
              source={embeddingSource}
              onSourceChange={setEmbeddingSource}
              isValid={isEmbeddingValid}
              onValidationChange={setIsEmbeddingValid}
              device={tempEmbeddingDevice}
              onDeviceChange={setTempEmbeddingDevice}
              savedModelName={getModelName('embedding')}
              savedModelType={embeddingSavedModelType}
              onTempFileUpload={setTempEmbeddingLocalFilePath}
              onDeleteModel={(id, e) =>
                handleDeleteModel(id, EMBEDDING_TYPE, e)
              }
              extraParams={tempEmbeddingParams}
              onExtraParamsChange={setTempEmbeddingParams}
            />

            <WorkloadModelConfiguration
              title="Reranker Model"
              task={EMBEDDING_TYPE}
              modelType={RERANKER_TYPE}
              engine={tempEngine}
              verifiedModels={verifiedReranker}
              customModels={customReranker}
              selectedModel={resolvedTempRerankerModel}
              onModelSelect={setTempRerankerModelOverride}
              tabValue={resolvedRerankerTabValue}
              onTabChange={setRerankerTabValue}
              source={rerankerSource}
              onSourceChange={setRerankerSource}
              isValid={isRerankerValid}
              onValidationChange={setIsRerankerValid}
              device={tempRerankerDevice}
              onDeviceChange={setTempRerankerDevice}
              savedModelName={getModelName('reranker')}
              savedModelType={rerankerSavedModelType}
              onTempFileUpload={setTempRerankerLocalFilePath}
              onDeleteModel={(id, e) => handleDeleteModel(id, RERANKER_TYPE, e)}
              extraParams={tempRerankerParams}
              onExtraParamsChange={setTempRerankerParams}
            />
          </div>
        )}

        <Separator className="my-4" />

        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="outline"
            disabled={isLoading}
            onClick={handleCancel}
            className="min-w-[100px]"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isLoading || !canSave}
            className="min-w-[120px] bg-blue-600 hover:bg-blue-700"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Settings'
            )}
          </Button>
        </div>
      </DialogContent>
      <ConfirmationDialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={confirmDeleteModel}
        title="Delete Model"
        description={`Are you sure you want to delete model "${modelToDelete?.id}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="destructive"
        isLoading={isDeleting}
      />
    </Dialog>
  )
}
