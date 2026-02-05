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
import { FileSearch, ExternalLink, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ImageGenerationSettings, Model } from '@/types/workload'
import { DeviceSelector } from '../../common/device-selector'
import {
  ModelSource,
  ModelSourceSelector,
} from '../../common/model-source-selector'

interface SettingsModalProps {
  task: string
  isOpen: boolean
  onClose: () => void
  currentSettings: ImageGenerationSettings
  updateSettings: (settings: ImageGenerationSettings) => Promise<unknown>
  availableModels: Model[]
}

export function SettingsModal({
  task,
  isOpen,
  onClose,
  availableModels,
  currentSettings: { model: currentModel },
  updateSettings,
}: SettingsModalProps) {
  const [tempModelName, setTempModelName] = useState(currentModel.name || '')
  const [tempDevice, setTempDevice] = useState(currentModel.device || 'CPU')
  const [tempSource, setTempSource] = useState<ModelSource>(
    (currentModel.source as ModelSource) || 'huggingface',
  )
  const [tabValue, setTabValue] = useState('predefined')
  const [isLoading, setIsLoading] = useState(false)

  const handleDeviceSelect = (value: string) => {
    setTempDevice(value)
  }

  const handleSave = () => {
    let model: Model = {
      name: tempModelName,
      device: tempDevice,
      source: tempSource,
    }
    setIsLoading(true)
    if (tabValue === 'predefined') {
      const selected = availableModels.find((m) => m.name === tempModelName)
      if (selected) {
        model = { ...selected, device: tempDevice, source: tempSource }
      }
    }

    updateSettings({ model }).then(() => {
      setIsLoading(false)
      onClose()
    })
  }

  const handleModelSelect = (value: string) => {
    setTempModelName(value)
  }

  const handleTabChange = (value: string) => {
    setTabValue(value)
    if (value === 'predefined') {
      if (!tempModelName) setTempModelName(currentModel.name)
    } else {
      setTempModelName('')
      setTempDevice('CPU')
    }
  }

  useEffect(() => {
    setTempModelName(currentModel.name || availableModels[0].name)
    setTempDevice(currentModel.device || 'CPU')
  }, [availableModels, currentModel])

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
          defaultValue="custom"
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="predefined">Verified Models</TabsTrigger>
            <TabsTrigger value="custom">Custom Model</TabsTrigger>
          </TabsList>

          <TabsContent value="predefined" className="space-y-4">
            <ModelSourceSelector value={tempSource} onChange={setTempSource} />
            <div>
              <Label htmlFor="model-select" className="text-base font-medium">
                Select Model
              </Label>
              <Select value={tempModelName} onValueChange={handleModelSelect}>
                <SelectTrigger className="mt-2 w-full">
                  <SelectValue placeholder="Choose a model" />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem key={model.name} value={model.name}>
                      <div className="flex flex-col">
                        <span className="font-medium">{model.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DeviceSelector value={tempDevice} onChange={handleDeviceSelect} />
          </TabsContent>

          <TabsContent value="custom" className="space-y-4">
            <div className="space-y-4">
              <ModelSourceSelector
                value={tempSource}
                onChange={setTempSource}
              />
              <div>
                <Label htmlFor="custom-url" className="text-base font-medium">
                  Model Name
                </Label>
                <Input
                  id="custom-url"
                  placeholder={availableModels[0]?.name}
                  value={tempModelName}
                  onChange={(e) => setTempModelName(e.target.value)}
                  className="mt-2"
                />
                <p className="mt-1 text-sm text-gray-500">
                  Enter the Hugging Face Model name for your model
                </p>
              </div>
            </div>

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
                  <li>Ensure the model supports {task.toLowerCase()}</li>
                </ol>
              </div>
            </div>

            <DeviceSelector value={tempDevice} onChange={handleDeviceSelect} />
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
            disabled={isLoading}
            className="bg-blue-600 text-white"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
