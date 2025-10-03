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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ExternalLink, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAccelerator } from '@/hooks/use-accelerators'

export interface Model {
  name: string
  value: string
  type: string
}

export interface EmbeddingSettings {
  embeddingModel: Model
  embeddingDevice: string
  rerankerModel: Model
  rerankerDevice: string
}

interface EmbeddingSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  selectedEmbeddingModel: string
  selectedEmbeddingDevice: string
  selectedRerankerModel: string
  selectedRerankerDevice: string
  availableEmbeddingModels: Model[]
  availableRerankerModels: Model[]
  updateSettings: (settings: EmbeddingSettings) => Promise<unknown>
}

export function EmbeddingSettingsModal({
  isOpen,
  onClose,
  selectedEmbeddingModel,
  selectedEmbeddingDevice,
  selectedRerankerModel,
  selectedRerankerDevice,
  availableEmbeddingModels,
  availableRerankerModels,
  updateSettings,
}: EmbeddingSettingsModalProps) {
  // Embedding model states
  const [tempEmbeddingModel, setTempEmbeddingModel] = useState(
    selectedEmbeddingModel || '',
  )
  const [tempEmbeddingDevice, setTempEmbeddingDevice] = useState(
    selectedEmbeddingDevice || 'CPU',
  )
  const [embeddingTabValue, setEmbeddingTabValue] = useState('predefined')

  // Reranker model states
  const [tempRerankerModel, setTempRerankerModel] = useState(
    selectedRerankerModel || '',
  )
  const [tempRerankerDevice, setTempRerankerDevice] = useState(
    selectedRerankerDevice || 'CPU',
  )
  const [rerankerTabValue, setRerankerTabValue] = useState('predefined')

  const [isLoading, setIsLoading] = useState(false)
  const { data: devices } = useAccelerator()

  const handleSave = () => {
    // Handle embedding model
    let embeddingModel = {
      name: tempEmbeddingModel,
      value: tempEmbeddingModel,
      type: 'custom',
    }
    if (embeddingTabValue !== 'custom') {
      const selected = availableEmbeddingModels.find(
        (model) => model.value === tempEmbeddingModel,
      )
      if (selected) {
        embeddingModel = selected
      }
    }

    // Handle reranker model
    let rerankerModel = {
      name: tempRerankerModel,
      value: tempRerankerModel,
      type: 'custom',
    }
    if (rerankerTabValue !== 'custom') {
      const selected = availableRerankerModels.find(
        (model) => model.value === tempRerankerModel,
      )
      if (selected) {
        rerankerModel = selected
      }
    }

    setIsLoading(true)
    updateSettings({
      embeddingModel,
      embeddingDevice: tempEmbeddingDevice,
      rerankerModel,
      rerankerDevice: tempRerankerDevice,
    })
      .then(() => {
        setIsLoading(false)
        onClose()
      })
      .catch(() => {
        setIsLoading(false)
      })
  }

  const handleEmbeddingTabChange = (value: string) => {
    setEmbeddingTabValue(value)
    if (value === 'predefined') {
      if (!tempEmbeddingModel) setTempEmbeddingModel(selectedEmbeddingModel)
    } else {
      setTempEmbeddingModel('')
    }
  }

  const handleRerankerTabChange = (value: string) => {
    setRerankerTabValue(value)
    if (value === 'predefined') {
      if (!tempRerankerModel) setTempRerankerModel(selectedRerankerModel)
    } else {
      setTempRerankerModel('')
    }
  }

  useEffect(() => {
    setTempEmbeddingModel(
      selectedEmbeddingModel || availableEmbeddingModels[0]?.value || '',
    )
    setTempEmbeddingDevice(selectedEmbeddingDevice || 'CPU')
    setTempRerankerModel(
      selectedRerankerModel || availableRerankerModels[0]?.value || '',
    )
    setTempRerankerDevice(selectedRerankerDevice || 'CPU')
  }, [
    selectedEmbeddingModel,
    selectedEmbeddingDevice,
    selectedRerankerModel,
    selectedRerankerDevice,
    availableEmbeddingModels,
    availableRerankerModels,
  ])

  const DeviceSelector = ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: string) => void
  }) => {
    return (
      <div>
        <Label htmlFor="device-select" className="text-base font-medium">
          Device
        </Label>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="mt-2 w-full">
            <SelectValue placeholder="Choose a device" />
          </SelectTrigger>
          <SelectContent>
            {(devices ?? []).map((device) => (
              <SelectItem key={device.id} value={device.id}>
                <div className="flex flex-col">
                  <span className="font-medium">{device.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  const ModelSelector = ({
    models,
    selectedModel,
    onModelSelect,
    tabValue,
    onTabChange,
    modelType,
  }: {
    models: Model[]
    selectedModel: string
    onModelSelect: (value: string) => void
    tabValue: string
    onTabChange: (value: string) => void
    modelType: string
  }) => {
    return (
      <div>
        <Label className="text-base font-medium">{modelType}</Label>
        <Tabs value={tabValue} onValueChange={onTabChange} className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="predefined">Verified</TabsTrigger>
            <TabsTrigger value="custom">Custom</TabsTrigger>
          </TabsList>

          <TabsContent value="predefined" className="space-y-4">
            <div>
              <Label htmlFor="model-select" className="text-base font-medium">
                Model
              </Label>
              <Select value={selectedModel} onValueChange={onModelSelect}>
                <SelectTrigger className="mt-2 w-full">
                  <SelectValue
                    placeholder={`Choose a ${modelType.toLowerCase()} model`}
                  />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.value} value={model.name}>
                      <div className="flex flex-col">
                        <span className="font-medium">{model.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="custom" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`custom-${modelType.toLowerCase()}-model`}>
                Model Name
              </Label>
              <Input
                id={`custom-${modelType.toLowerCase()}-model`}
                placeholder={models[0].value}
                value={selectedModel}
                onChange={(e) => onModelSelect(e.target.value)}
              />
              <p className="mt-1 text-sm text-gray-500">
                Enter the Hugging Face Model name for your model
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Embedding Service Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Embedding Model Section */}
          <div className="space-y-4">
            <ModelSelector
              models={availableEmbeddingModels}
              selectedModel={tempEmbeddingModel}
              onModelSelect={setTempEmbeddingModel}
              tabValue={embeddingTabValue}
              onTabChange={handleEmbeddingTabChange}
              modelType="Embedding"
            />

            <DeviceSelector
              value={tempEmbeddingDevice}
              onChange={setTempEmbeddingDevice}
            />
          </div>

          <Separator />

          {/* Reranker Model Section */}
          <div className="space-y-4">
            <ModelSelector
              models={availableRerankerModels}
              selectedModel={tempRerankerModel}
              onModelSelect={setTempRerankerModel}
              tabValue={rerankerTabValue}
              onTabChange={handleRerankerTabChange}
              modelType="Reranker"
            />

            <DeviceSelector
              value={tempRerankerDevice}
              onChange={setTempRerankerDevice}
            />
          </div>

          <Separator />

          {(embeddingTabValue === 'custom' ||
            rerankerTabValue === 'custom') && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
              <h4 className="mb-2 flex items-center gap-2 font-medium text-orange-900">
                <ExternalLink className="h-4 w-4" />
                Hugging Face Setup
              </h4>
              <div className="space-y-2 text-sm text-orange-800">
                <p>To use custom Hugging Face models:</p>
                <ol className="ml-2 list-inside list-decimal space-y-1">
                  <li>Get your API key from Hugging Face</li>
                  <li>Add it as HF_TOKEN in your environment</li>
                  <li>
                    Ensure the model supports the respective tasks
                    (embedding/rerank)
                  </li>
                </ol>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-2 pt-4">
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
            disabled={isLoading}
            className="bg-blue-600 text-white"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Save Settings'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
