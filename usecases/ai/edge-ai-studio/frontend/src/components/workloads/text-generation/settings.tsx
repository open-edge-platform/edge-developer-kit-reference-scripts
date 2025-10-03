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
import { useAccelerator } from '@/hooks/use-accelerators'

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
  updateSettings: (device: string, model: Model) => Promise<unknown>
  availableModels: Model[]
  selectedDevice: string
}

export function SettingsModal({
  task,
  isOpen,
  onClose,
  availableModels,
  selectedModel,
  selectedDevice,
  updateSettings,
}: SettingsModalProps) {
  const [tempModel, setTempModel] = useState(selectedModel || '')
  const [tempDevice, setTempDevice] = useState(selectedDevice || 'CPU')
  const [tabValue, setTabValue] = useState('predefined')
  const [isLoading, setIsLoading] = useState(false)
  const { data: devices } = useAccelerator()

  const handleDeviceSelect = (value: string) => {
    setTempDevice(value)
  }

  const handleSave = () => {
    let model = {
      name: tempModel,
      value: tempModel,
      type: 'custom',
    }
    setIsLoading(true)
    if (tabValue !== 'custom') {
      const selected = availableModels.find(
        (model) => model.value === tempModel,
      )
      if (selected) {
        model = selected
      }
    }

    updateSettings(tempDevice, model).then(() => {
      setIsLoading(false)
      onClose()
    })
  }

  const handleModelSelect = (value: string) => {
    setTempModel(value)
  }

  const handleTabChange = (value: string) => {
    setTabValue(value)
    if (value === 'predefined') {
      if (!tempModel) setTempModel(selectedModel)
    } else {
      setTempModel('')
    }
  }

  useEffect(() => {
    setTempModel(selectedModel || availableModels[0].name)
  }, [availableModels, selectedModel])

  useEffect(() => {
    setTempDevice(selectedDevice || 'CPU')
  }, [selectedDevice])

  const DeviceSelector = () => {
    return (
      <div>
        <Label htmlFor="model-select" className="text-base font-medium">
          Device
        </Label>
        <Select value={tempDevice} onValueChange={handleDeviceSelect}>
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
            <div>
              <Label htmlFor="model-select" className="text-base font-medium">
                Select Model
              </Label>
              <Select value={tempModel} onValueChange={handleModelSelect}>
                <SelectTrigger className="mt-2 w-full">
                  <SelectValue placeholder="Choose a model" />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem key={model.name} value={model.value}>
                      <div className="flex flex-col">
                        <span className="font-medium">{model.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DeviceSelector />
          </TabsContent>

          <TabsContent value="custom" className="space-y-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="custom-url" className="text-base font-medium">
                  Model Name
                </Label>
                <Input
                  id="custom-url"
                  placeholder="OpenVINO/Phi-3.5-mini-instruct-int4-ov"
                  value={tempModel}
                  onChange={(e) => setTempModel(e.target.value)}
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

            <DeviceSelector />
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
