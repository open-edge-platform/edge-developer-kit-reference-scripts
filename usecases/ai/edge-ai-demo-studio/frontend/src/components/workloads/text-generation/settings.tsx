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
  const [tempModel, setTempModel] = useState('')
  const [tempEngine, setTempEngine] = useState<Workload['engine']>(
    selectedEngine || 'ovms',
  )
  const { data: models, isLoading: areModelsLoading } = useGetWorkloadModels(
    TEXT_GENERATION_TYPE,
    tempEngine,
  )

  const { mutate: deleteModel, isPending: isDeleting } =
    useDeleteWorkloadModel()
  const [modelToDelete, setModelToDelete] = useState<string | null>(null)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)

  const verifiedModels = useMemo<ModelList>(() => {
    if (!models) return []
    return models.filter((model) => model.verified)
  }, [models])

  const customModels = useMemo<ModelList>(() => {
    if (!models) return []
    return models.filter((model) => !model.verified)
  }, [models])

  const [tempDevice, setTempDevice] = useState(selectedModel?.device || 'CPU')
  const [tempParams, setTempParams] = useState<string>(
    selectedModel?.params || '',
  )
  const [tabValue, setTabValue] = useState('predefined')
  const [isLoading, setIsLoading] = useState(false)
  const [tempLocalFilePath, setTempLocalFilePath] = useState('')
  const [isModelValid, setIsModelValid] = useState(true)
  const [modelSource, setModelSource] = useState<
    'huggingface' | 'modelscope' | 'custom'
  >(selectedModel?.source ?? 'huggingface')
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)
  if (isOpen !== prevIsOpen) {
    if (isOpen && !areModelsLoading && models) {
      setPrevIsOpen(isOpen)
      setTempEngine(selectedEngine || 'ovms')
      setTempDevice(selectedModel?.device || 'CPU')
      setTempLocalFilePath('')
      setIsModelValid(true)
      setModelSource(selectedModel.source || 'huggingface')

      // Since verifiedModels is for tempEngine (initially selectedEngine),
      // we check if selected model is in there.
      // If initialized with selectedEngine, verifiedModels covers it.
      const isCustomModel = !verifiedModels.some(
        (model) => model.id === selectedModelName,
      )

      // Set the correct tab
      if (isCustomModel) {
        setTabValue('custom')
        setTempModel(selectedModelName || '')
      } else {
        setTabValue('predefined')
        setTempModel(selectedModelName || verifiedModels[0]?.id || '')
      }
    }
  }

  const canSave = useMemo(() => {
    if (!tempDevice) return false
    if (!tempEngine) return false
    if (!tempModel || tempModel.trim().length === 0) return false

    if (tabValue === 'custom') {
      if (modelSource === 'custom') {
        return (
          !!tempModel &&
          tempModel.trim().length > 0 &&
          (!!tempLocalFilePath ||
            !!customModels.find((m) => m.id === tempModel)?.downloaded)
        )
      }
      return !!tempModel && tempModel.trim().length > 0 && isModelValid
    } else {
      if (
        tempModel.trim() === '' ||
        !verifiedModels.find((m) => m.id === tempModel)
      ) {
        return false
      }
    }

    return true
  }, [
    customModels,
    isModelValid,
    modelSource,
    tabValue,
    tempDevice,
    tempEngine,
    tempLocalFilePath,
    tempModel,
    verifiedModels,
  ])

  const savedModelType = useMemo(() => {
    if (selectedEngine !== tempEngine) return undefined
    const isCustomModel = !verifiedModels.some(
      (model) => model.id === selectedModelName,
    )

    return isCustomModel ? 'custom' : 'verified'
  }, [selectedEngine, selectedModelName, tempEngine, verifiedModels])

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
            if (tempModel === modelToDelete) {
              setTempModel('')
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
      tabValue === 'custom' &&
      tempModel !== '' &&
      !customModels.find((m) => m.id === tempModel)?.downloaded &&
      availableModels.filter((m) => m !== selectedModelName).includes(tempModel)
    ) {
      toast.error('Model name already exists. Please choose a different name.')
      return false
    } else if (tempModel.trim() === '') {
      toast.error('Model name cannot be empty.')
      return false
    }

    return true
  }

  const handleEngineSelect = (value: Workload['engine']) => {
    setTempEngine(value)
    setTempDevice('CPU')
  }

  const handleSave = () => {
    let model: Model = {
      name: tempModel,
      source: modelSource,
      device: tempDevice,
      params: tempParams,
    }
    if (!validateModelName()) {
      return
    }
    setIsLoading(true)
    if (tabValue !== 'custom') {
      const selected = verifiedModels.find((m) => m.id === tempModel)
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
      const colonIndex = tempModel.indexOf(':')
      if (colonIndex !== -1) {
        const baseModel = tempModel.substring(0, colonIndex)
        const quant = tempModel.substring(colonIndex + 1)
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

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
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
                selectedModel={tempModel}
                onModelSelect={setTempModel}
                tabValue={tabValue}
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
              onClick={onClose}
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
