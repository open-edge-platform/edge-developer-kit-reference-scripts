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
    selectedEngine || 'ovms',
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
  const [tempEmbeddingModel, setTempEmbeddingModel] = useState('')
  const [tempEmbeddingDevice, setTempEmbeddingDevice] = useState(
    selectedEmbeddingModel?.device || 'CPU',
  )
  const [tempEmbeddingParams, setTempEmbeddingParams] = useState(
    selectedEmbeddingModel?.params || '',
  )
  const [embeddingTabValue, setEmbeddingTabValue] = useState('predefined')
  const [isEmbeddingValid, setIsEmbeddingValid] = useState(true)
  const [embeddingSource, setEmbeddingSource] = useState<
    'huggingface' | 'modelscope' | 'custom'
  >(selectedEmbeddingModel?.source ?? 'huggingface')

  // Reranker state
  const [tempRerankerModel, setTempRerankerModel] = useState('')
  const [tempRerankerDevice, setTempRerankerDevice] = useState(
    selectedRerankerModel?.device || 'CPU',
  )
  const [tempRerankerParams, setTempRerankerParams] = useState(
    selectedRerankerModel?.params || '',
  )
  const [rerankerTabValue, setRerankerTabValue] = useState('predefined')
  const [isRerankerValid, setIsRerankerValid] = useState(true)
  const [rerankerSource, setRerankerSource] = useState<
    'huggingface' | 'modelscope' | 'custom'
  >(selectedRerankerModel?.source ?? 'huggingface')

  const verifiedEmbedding = useMemo<ModelList>(() => {
    if (!embeddingModelsList) return []
    return embeddingModelsList.filter((m) => m.verified)
  }, [embeddingModelsList])

  const customEmbedding = useMemo<ModelList>(() => {
    if (!embeddingModelsList) return []
    return embeddingModelsList.filter((m) => !m.verified)
  }, [embeddingModelsList])

  const verifiedReranker = useMemo<ModelList>(() => {
    if (!rerankerModelsList) return []
    return rerankerModelsList.filter((m) => m.verified)
  }, [rerankerModelsList])

  const customReranker = useMemo<ModelList>(() => {
    if (!rerankerModelsList) return []
    return rerankerModelsList.filter((m) => !m.verified)
  }, [rerankerModelsList])

  const [isLoading, setIsLoading] = useState(false)

  // Temp file paths (unused in final logic but needed for state)
  const [, setTempEmbeddingLocalFilePath] = useState('')
  const [, setTempRerankerLocalFilePath] = useState('')

  const embeddingSavedModelType = useMemo(() => {
    if (selectedEngine !== tempEngine) return undefined
    const name = getModelName('embedding')
    const isVerified = verifiedEmbedding.some((m) => m.id === name)
    return isVerified ? 'verified' : 'custom'
  }, [getModelName, selectedEngine, tempEngine, verifiedEmbedding])

  const rerankerSavedModelType = useMemo(() => {
    if (selectedEngine !== tempEngine) return undefined
    const name = getModelName('reranker')
    const isVerified = verifiedReranker.some((m) => m.id === name)
    return isVerified ? 'verified' : 'custom'
  }, [getModelName, selectedEngine, tempEngine, verifiedReranker])

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)
  if (isOpen !== prevIsOpen) {
    // Ensure models have finished loading before initializing temp state
    if (
      isOpen &&
      !isEmbeddingLoading &&
      !isRerankerLoading &&
      embeddingModelsList &&
      rerankerModelsList
    ) {
      setPrevIsOpen(isOpen)
      setTempEngine(selectedEngine || 'ovms')

      // Embedding Init
      setTempEmbeddingDevice(selectedEmbeddingModel?.device || 'CPU')
      setEmbeddingSource(selectedEmbeddingModel?.source || 'huggingface')
      const embeddingName = getModelName('embedding')
      const isEmbeddingVerified = verifiedEmbedding.some(
        (m) => m.id === embeddingName,
      )
      if (isEmbeddingVerified) {
        setEmbeddingTabValue('predefined')
        setTempEmbeddingModel(embeddingName)
      } else if (embeddingName) {
        setEmbeddingTabValue('custom')
        setTempEmbeddingModel(embeddingName)
      } else {
        setEmbeddingTabValue('predefined')
        setTempEmbeddingModel(verifiedEmbedding[0]?.id || '')
      }

      // Reranker Init
      setTempRerankerDevice(selectedRerankerModel?.device || 'CPU')
      setRerankerSource(selectedRerankerModel?.source || 'huggingface')
      const rerankerName = getModelName('reranker')
      const isRerankerVerified = verifiedReranker.some(
        (m) => m.id === rerankerName,
      )
      if (isRerankerVerified) {
        setRerankerTabValue('predefined')
        setTempRerankerModel(rerankerName)
      } else if (rerankerName) {
        setRerankerTabValue('custom')
        setTempRerankerModel(rerankerName)
      } else {
        setRerankerTabValue('predefined')
        setTempRerankerModel(verifiedReranker[0]?.id || '')
      }
    }
  }

  // Handlers
  const handleEngineSelect = (value: Workload['engine']) => {
    setTempEngine(value)
    // Devices reset to CPU handled by state init if needed, or user selecting
    setTempEmbeddingDevice('CPU')
    setTempRerankerDevice('CPU')
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
              tempEmbeddingModel === modelToDelete.id
            ) {
              setTempEmbeddingModel('')
            }
            if (
              modelToDelete.type === RERANKER_TYPE &&
              tempRerankerModel === modelToDelete.id
            ) {
              setTempRerankerModel('')
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
        tempEmbeddingModel,
        'embedding',
        embeddingTabValue,
        embeddingSource,
      ) ||
      !validateModelName(
        tempRerankerModel,
        'reranker',
        rerankerTabValue,
        rerankerSource,
      )
    ) {
      return
    }

    // Embedding Model Construction
    let embeddingModel: Model = {
      name: tempEmbeddingModel,
      source: embeddingSource,
      device: tempEmbeddingDevice,
      params: tempEmbeddingParams,
    }

    if (embeddingTabValue !== 'custom') {
      const selected = verifiedEmbedding.find(
        (m) => m.id === tempEmbeddingModel,
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
      const colonIndex = tempEmbeddingModel.indexOf(':')
      if (colonIndex !== -1) {
        embeddingModel = {
          name: tempEmbeddingModel.substring(0, colonIndex),
          quant: tempEmbeddingModel.substring(colonIndex + 1),
          source: embeddingSource,
          device: tempEmbeddingDevice,
          params: tempEmbeddingParams,
        }
      }
    }

    // Reranker Model Construction
    let rerankerModel: Model = {
      name: tempRerankerModel,
      source: rerankerSource,
      device: tempRerankerDevice,
      params: tempRerankerParams,
    }

    if (rerankerTabValue !== 'custom') {
      const selected = verifiedReranker.find((m) => m.id === tempRerankerModel)
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
      const colonIndex = tempRerankerModel.indexOf(':')
      if (colonIndex !== -1) {
        rerankerModel = {
          name: tempRerankerModel.substring(0, colonIndex),
          quant: tempRerankerModel.substring(colonIndex + 1),
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

  const canSave =
    tempEmbeddingModel &&
    tempRerankerModel &&
    isEmbeddingValid &&
    isRerankerValid &&
    tempEmbeddingDevice &&
    tempRerankerDevice

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-[700px]">
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
              selectedModel={tempEmbeddingModel}
              onModelSelect={setTempEmbeddingModel}
              tabValue={embeddingTabValue}
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
              selectedModel={tempRerankerModel}
              onModelSelect={setTempRerankerModel}
              tabValue={rerankerTabValue}
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
            onClick={onClose}
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
