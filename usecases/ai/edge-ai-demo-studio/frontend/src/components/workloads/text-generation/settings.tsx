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
import { Skeleton } from '@/components/ui/skeleton'
import { FileSearch, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  InferenceEngine,
  Model,
  ModelList,
  TextGenerationSettings,
} from '@/types/workload'
import { Workload } from '@/payload-types'
import { getModelNameWithQuant } from '@/utils/common'
import { EngineSelector } from '@/components/common/engine-selector'
import {
  useGetWorkloadModels,
  useDeleteWorkloadModel,
} from '@/hooks/use-workload'
import { ConfirmationDialog } from '@/components/common/confirmation-dialog'
import { toast } from 'sonner'
import { TEXT_GENERATION_TYPE } from '@/lib/workloads/text-generation'
import { WorkloadModelConfiguration } from '@/components/common/multiserve/multiserve-model-configuration'
import { CurrentSelectionBadge } from '@/components/common/model-selector'

interface SettingsModalProps {
  task: string
  isOpen: boolean
  onClose: () => void
  engines: InferenceEngine[]
  updateSettings: (settings: TextGenerationSettings) => Promise<unknown>
  currentSettings: TextGenerationSettings
}

export function SettingsModal({
  task,
  isOpen,
  onClose,
  engines,
  updateSettings,
  currentSettings: { model: selectedModel, engine: selectedEngine },
}: SettingsModalProps) {
  const selectedModelName = useMemo(() => {
    return getModelNameWithQuant(selectedModel, selectedEngine)
  }, [selectedEngine, selectedModel])
  const [tempEngine, setTempEngine] = useState<Workload['engine']>(
    selectedEngine || 'openvino',
  )
  const { data: models, isLoading: areModelsLoading } = useGetWorkloadModels(
    TEXT_GENERATION_TYPE,
    tempEngine,
  )

  const { mutate: deleteModel, isPending: isDeleting } =
    useDeleteWorkloadModel()
  const [modelToDelete, setModelToDelete] = useState<string | null>(null)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)

  const derivedModels = useMemo(() => {
    const verified: ModelList = []
    const custom: ModelList = []

    if (models) {
      models.forEach((model) => {
        if (model.verified) {
          verified.push({ ...model })
        } else {
          custom.push({ ...model })
        }
      })
    }

    return { verified, custom }
  }, [models])

  const verifiedModels = useMemo(() => {
    return tempEngine ? derivedModels.verified : []
  }, [derivedModels.verified, tempEngine])

  const customModels = useMemo(() => {
    return tempEngine ? derivedModels.custom : []
  }, [derivedModels.custom, tempEngine])
  const [tempDevice, setTempDevice] = useState(selectedModel?.device || 'CPU')
  const [tempParams, setTempParams] = useState<string>(
    selectedModel?.params || '',
  )
  const [tabValue, setTabValue] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [tempLocalFilePath, setTempLocalFilePath] = useState('')
  const [isModelValid, setIsModelValid] = useState(true)
  const [modelSource, setModelSource] = useState<
    'huggingface' | 'modelscope' | 'custom'
  >(selectedModel.source ?? 'huggingface')
  const [tempModelOverride, setTempModelOverride] = useState<string | null>(
    null,
  )

  const savedModelType = useMemo(() => {
    if (tempEngine !== selectedEngine) return 'verified'
    const isCustomModel = !verifiedModels.some(
      (model) => model.id === selectedModelName,
    )

    return isCustomModel ? 'custom' : 'verified'
  }, [selectedModelName, verifiedModels, tempEngine, selectedEngine])

  const resolvedTabValue = useMemo(() => {
    if (tabValue) return tabValue
    return savedModelType === 'custom' ? 'custom' : 'predefined'
  }, [savedModelType, tabValue])

  const resolvedTempModel = useMemo(() => {
    if (tempModelOverride !== null) return tempModelOverride
    if (tempEngine !== selectedEngine) return verifiedModels[0]?.id || ''
    if (savedModelType === 'custom') return selectedModelName || ''
    return selectedModelName || verifiedModels[0]?.id || ''
  }, [
    savedModelType,
    selectedModelName,
    tempModelOverride,
    verifiedModels,
    tempEngine,
    selectedEngine,
  ])

  const canSave = useMemo(() => {
    if (!tempDevice) return false
    if (!tempEngine) return false
    if (!resolvedTempModel || resolvedTempModel.trim().length === 0)
      return false

    if (resolvedTabValue === 'custom') {
      if (modelSource === 'custom') {
        return (
          !!resolvedTempModel &&
          resolvedTempModel.trim().length > 0 &&
          (!!tempLocalFilePath ||
            !!customModels.find((m) => m.id === resolvedTempModel)?.downloaded)
        )
      }
      return (
        !!resolvedTempModel &&
        resolvedTempModel.trim().length > 0 &&
        isModelValid
      )
    } else {
      if (
        resolvedTempModel.trim() === '' ||
        !verifiedModels.find((m) => m.id === resolvedTempModel)
      ) {
        return false
      }
    }

    return true
  }, [
    customModels,
    isModelValid,
    modelSource,
    resolvedTabValue,
    tempDevice,
    tempEngine,
    tempLocalFilePath,
    resolvedTempModel,
    verifiedModels,
  ])

  const handleDeleteModel = async (
    modelId: string,
    event: React.MouseEvent,
  ) => {
    event.stopPropagation()
    setModelToDelete(modelId)
    setIsDeleteConfirmOpen(true)
  }

  const confirmDeleteModel = () => {
    if (modelToDelete) {
      deleteModel(
        {
          engine: tempEngine,
          type: TEXT_GENERATION_TYPE,
          name: modelToDelete,
        },
        {
          onSuccess: () => {
            setIsDeleteConfirmOpen(false)
            setModelToDelete(null)
            if (resolvedTempModel === modelToDelete) {
              setTempModelOverride('')
            }
          },
        },
      )
    }
  }

  const validateModelName = () => {
    const availableModels = [
      ...verifiedModels.map((m) => m.id),
      ...customModels.map((m) => m.id),
    ]
    if (
      resolvedTabValue === 'custom' &&
      resolvedTempModel !== '' &&
      !customModels.find((m) => m.id === resolvedTempModel)?.downloaded &&
      availableModels
        .filter((m) => m !== selectedModelName)
        .includes(resolvedTempModel)
    ) {
      toast.error('Model name already exists. Please choose a different name.')
      return false
    } else if (resolvedTempModel.trim() === '') {
      toast.error('Model name cannot be empty.')
      return false
    }

    return true
  }

  const handleEngineSelect = (value: Workload['engine']) => {
    setTempEngine(value)
    setTempDevice('CPU')
    setTempModelOverride(null)
    setTabValue(null)
  }

  const handleSave = () => {
    let model: Model = {
      name: resolvedTempModel,
      source: modelSource,
      device: tempDevice,
      params: tempParams,
    }
    if (!validateModelName()) {
      return
    }
    setIsLoading(true)
    if (resolvedTabValue !== 'custom') {
      const selected = verifiedModels.find((m) => m.id === resolvedTempModel)
      if (selected) {
        let id = { ...selected }.id
        const colonIndex = id.indexOf(':')
        if (colonIndex !== -1) {
          id = id.substring(0, colonIndex)
        }
        model = {
          device: tempDevice,
          name: id,
          source: modelSource,
          params: tempParams,
          quant: selected.quant,
        }
      }
    } else {
      // For custom models, extract quant from model name if it follows format name:quant
      const colonIndex = resolvedTempModel.indexOf(':')
      if (colonIndex !== -1) {
        const baseModel = resolvedTempModel.substring(0, colonIndex)
        const quant = resolvedTempModel.substring(colonIndex + 1)
        model = {
          name: baseModel,
          source: modelSource,
          quant: quant,
          device: tempDevice,
          params: tempParams,
        }
      }
    }

    updateSettings({ model, engine: tempEngine }).then(() => {
      setIsLoading(false)
      onClose()
    })
  }

  const resetState = () => {
    setTempEngine(selectedEngine || 'openvino')
    setTempDevice(selectedModel?.device || 'CPU')
    setTempLocalFilePath('')
    setIsModelValid(true)
    setModelSource(selectedModel?.source || 'huggingface')
    setTempParams(selectedModel?.params || '')
    setTabValue(null)
    setTempModelOverride(null)
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
    <>
      <Dialog open={isOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
              <FileSearch className="h-5 w-5" />
              {task} Settings
            </DialogTitle>
            {selectedModel && (
              <div className="pt-2">
                <CurrentSelectionBadge
                  label="Current Selection"
                  modelName={selectedModelName}
                  modelType={savedModelType}
                  engine={selectedEngine}
                />
              </div>
            )}
          </DialogHeader>

          {areModelsLoading ? (
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
                task={TEXT_GENERATION_TYPE}
                modelType={TEXT_GENERATION_TYPE}
                engine={tempEngine}
                verifiedModels={verifiedModels}
                customModels={customModels}
                selectedModel={resolvedTempModel}
                onModelSelect={setTempModelOverride}
                tabValue={resolvedTabValue}
                onTabChange={setTabValue}
                source={modelSource}
                onSourceChange={setModelSource}
                isValid={isModelValid}
                onValidationChange={setIsModelValid}
                device={tempDevice}
                onDeviceChange={setTempDevice}
                savedModelName={selectedModelName}
                savedModelType={savedModelType}
                onTempFileUpload={setTempLocalFilePath}
                onDeleteModel={handleDeleteModel}
                extraParams={tempParams}
                onExtraParamsChange={setTempParams}
              />
            </div>
          )}

          <div className="flex justify-end space-x-2 border-t pt-4">
            <Button
              variant="outline"
              disabled={isLoading}
              onClick={handleCancel}
              className="bg-white text-gray-700"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isLoading || !canSave}
              className="bg-blue-600 text-white disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmationDialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={confirmDeleteModel}
        title="Delete Model"
        description={`Are you sure you want to delete model "${modelToDelete}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="destructive"
        isLoading={isDeleting}
      />
    </>
  )
}
