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
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Slider } from '@/components/ui/slider'
import { MultiSelect } from '@/components/ui/multi-select'
import {
  FileSearch,
  ExternalLink,
  Loader2,
  Upload,
  X,
  BadgeCheck,
  CloudDownload,
} from 'lucide-react'
import { useEffect, useState, useRef, useMemo } from 'react'
import { toast } from 'sonner'
import {
  useUploadWakeWordModel,
  useReloadWakeWordModels,
  useListWakeWordModels,
  useGetDetectionStatus,
} from '@/hooks/use-wake-word-detection'

export interface Model {
  name: string
  value: string
  type: string
}

interface SettingsModalProps {
  task: string
  isOpen: boolean
  onClose: () => void
  selectedModel: string
  updateSettings: (model: Model[], vadThreshold: number) => Promise<unknown>
  predefinedModels: Model[]
  vadThreshold?: number
  workloadStatus?:
    | 'error'
    | 'restart'
    | 'active'
    | 'prepare'
    | 'inactive'
    | null
}

export function SettingsModal({
  task,
  isOpen,
  onClose,
  predefinedModels,
  selectedModel,
  updateSettings,
  vadThreshold: initialVadThreshold,
  workloadStatus,
}: SettingsModalProps) {
  const [selectedModels, setSelectedModels] = useState<Model[]>([])
  const [vadThreshold, setVadThreshold] = useState(initialVadThreshold ?? 0.2)
  const [tabValue, setTabValue] = useState('predefined')
  const [isLoading, setIsLoading] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadModel = useUploadWakeWordModel()
  const reloadModels = useReloadWakeWordModels()
  const { data: availableModelsData, refetch: refetchModels } =
    useListWakeWordModels({ enabled: isOpen && workloadStatus === 'active' })
  const { data: detectionStatus } = useGetDetectionStatus({
    enabled: isOpen && workloadStatus === 'active',
  })

  // Create a set of predefined model filenames for quick lookup
  const predefinedModelFilenames = useMemo(
    () => new Set(predefinedModels.map((m) => m.value)),
    [predefinedModels],
  )

  // Create a set of downloaded model filenames
  const downloadedModelFilenames = useMemo(
    () =>
      new Set(
        availableModelsData?.models?.map(
          (model: { filename: string }) => model.filename,
        ) || [],
      ),
    [availableModelsData],
  )

  // Combine predefined models with downloaded models from API
  const allAvailableModels = useMemo(() => {
    // Start with all predefined models
    const predefinedWithStatus = predefinedModels.map((model) => ({
      ...model,
      downloaded: downloadedModelFilenames.has(model.value),
    }))

    // Add custom models (downloaded but not in predefined list)
    const customModels =
      availableModelsData?.models
        ?.filter(
          (model: { filename: string }) =>
            !predefinedModelFilenames.has(model.filename),
        )
        .map((model: { filename: string; path: string }) => ({
          name: model.filename.replace('.onnx', ''),
          value: model.filename,
          type: 'custom',
          downloaded: true,
        })) || []

    return [...predefinedWithStatus, ...customModels]
  }, [
    availableModelsData,
    predefinedModels,
    predefinedModelFilenames,
    downloadedModelFilenames,
  ])

  // Group models by type for MultiSelect
  const groupedModels = useMemo(() => {
    const predefined = allAvailableModels.filter((m) => m.type === 'predefined')
    const custom = allAvailableModels.filter((m) => m.type === 'custom')

    const groups = []
    if (predefined.length > 0) {
      groups.push({
        heading: 'Predefined Models',
        options: predefined.map((model) => ({
          label: model.name,
          value: model.value,
          icon: model.downloaded ? BadgeCheck : CloudDownload,
        })),
      })
    }
    if (custom.length > 0) {
      groups.push({
        heading: 'Custom Models',
        options: custom.map((model) => ({
          label: model.name,
          value: model.value,
        })),
      })
    }
    return groups
  }, [allAvailableModels])

  const handleSave = async () => {
    setIsLoading(true)

    try {
      // Handle file upload in upload tab
      if (tabValue === 'upload' && uploadedFile) {
        const result = await uploadModel.mutateAsync(uploadedFile)

        toast.success('Model uploaded successfully', {
          description: result.filename,
        })

        // Refetch models list to include the newly uploaded model
        await refetchModels()

        setIsLoading(false)
        setUploadedFile(null)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        // Switch to models tab to configure the uploaded model
        setTabValue('models')
        return
      }

      // Validate that at least one model is selected (only for models tab)
      if (tabValue === 'models' && selectedModels.length === 0) {
        toast.error('Error', {
          description: 'Please select at least one model',
        })
        setIsLoading(false)
        return
      }

      // Only save settings if we're on the models tab
      if (tabValue === 'models') {
        // If service has models loaded, reload them with new configuration
        if (detectionStatus?.model_loaded) {
          await reloadModels.mutateAsync({
            modelFilenames: selectedModels.map((m) => m.value),
            vadThreshold,
          })
          toast.success('Models reloaded successfully')
        }

        await updateSettings(selectedModels, vadThreshold)
        toast.success('Settings saved successfully')
        onClose()
      }

      setIsLoading(false)
    } catch (error) {
      toast.error('Error', {
        description:
          error instanceof Error ? error.message : 'Failed to save settings',
      })
      setIsLoading(false)
    }
  }

  const handleModelChange = (values: string[]) => {
    const models = values
      .map((value) => allAvailableModels.find((m) => m.value === value))
      .filter((m): m is Model => m !== undefined)
    setSelectedModels(models)
  }

  const handleTabChange = (value: string) => {
    setTabValue(value)
    if (value === 'upload') {
      setUploadedFile(null)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.name.endsWith('.onnx')) {
        toast.error('Invalid file type', {
          description: 'Please upload an .onnx file',
        })
        return
      }
      setUploadedFile(file)
    }
  }

  const handleFileRemove = () => {
    setUploadedFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  useEffect(() => {
    // Parse selected models from comma-separated string
    if (selectedModel && allAvailableModels.length > 0) {
      const modelValues = selectedModel.split(' ')
      const models = modelValues
        .map((value) => allAvailableModels.find((m) => m.value === value))
        .filter((m): m is Model => m !== undefined)
      setSelectedModels(models)
    } else if (allAvailableModels.length > 0) {
      setSelectedModels([allAvailableModels[0]])
    }
  }, [allAvailableModels, selectedModel])

  useEffect(() => {
    setVadThreshold(initialVadThreshold ?? 0.2)
  }, [initialVadThreshold])

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <FileSearch className="h-5 w-5" />
            {task} Settings
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={tabValue}
          onValueChange={handleTabChange}
          defaultValue="models"
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="models">Models & Settings</TabsTrigger>
            <TabsTrigger value="upload">Upload Custom Model</TabsTrigger>
          </TabsList>

          <TabsContent value="models" className="space-y-4">
            {detectionStatus?.detection_active && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-900">
                  Detection is currently active
                </p>
                <p className="mt-1 text-sm text-amber-700">
                  Stop detection before changing model configuration
                </p>
              </div>
            )}

            <div>
              <Label className="text-base font-medium">
                Select Wake Word Models
              </Label>
              <p className="mt-1 text-sm text-gray-500">
                Select one or more wake word models to detect
              </p>
              <div className="mt-3">
                <MultiSelect
                  options={groupedModels}
                  onValueChange={handleModelChange}
                  defaultValue={selectedModels.map((m) => m.value)}
                  placeholder="Select wake word models"
                  variant="default"
                  maxCount={3}
                  disabled={detectionStatus?.detection_active}
                />
              </div>
            </div>

            <div>
              <Label className="text-base font-medium">VAD Threshold</Label>
              <p className="mt-1 text-sm text-gray-500">
                Voice Activity Detection threshold (0.0 to 1.0)
              </p>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    Current: {vadThreshold.toFixed(2)}
                  </span>
                </div>
                <Slider
                  value={[vadThreshold]}
                  onValueChange={(values) => setVadThreshold(values[0])}
                  min={0}
                  max={1}
                  step={0.05}
                  className="w-full"
                  disabled={detectionStatus?.detection_active}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>0.0 (More sensitive)</span>
                  <span>1.0 (Less sensitive)</span>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="upload" className="space-y-4">
            <div className="space-y-4">
              <div>
                <Label
                  htmlFor="custom-upload"
                  className="text-base font-medium"
                >
                  Upload Custom Model
                </Label>
                <p className="mt-1 text-sm text-gray-500">
                  Upload your custom wake word model in ONNX format
                </p>

                {!uploadedFile ? (
                  <div className="mt-3">
                    <input
                      ref={fileInputRef}
                      id="custom-upload"
                      type="file"
                      accept=".onnx"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full"
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Choose ONNX File
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3">
                    <div className="flex items-center space-x-2">
                      <FileSearch className="h-5 w-5 text-green-600" />
                      <span className="font-medium text-green-900">
                        {uploadedFile.name}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleFileRemove}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
              <h4 className="mb-2 flex items-center gap-2 font-medium text-orange-900">
                <ExternalLink className="h-4 w-4" />
                Custom Model Requirements
              </h4>
              <div className="space-y-2 text-sm text-orange-800">
                <p>For custom wake word models:</p>
                <ol className="ml-2 list-inside list-decimal space-y-1">
                  <li>Model must be in ONNX format (.onnx extension)</li>
                  <li>
                    Compatible with{' '}
                    <a
                      className="text-primary font-medium"
                      target="_blank"
                      href="https://github.com/dscripka/openWakeWord"
                    >
                      openWakeWord framework
                    </a>
                  </li>
                  <li>Trained specifically for wake word detection</li>
                </ol>
              </div>
            </div>
          </TabsContent>
        </Tabs>

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
            disabled={
              isLoading ||
              (tabValue === 'models' && detectionStatus?.detection_active)
            }
            className="bg-blue-600 text-white"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : tabValue === 'upload' ? (
              'Upload'
            ) : (
              'Save'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
