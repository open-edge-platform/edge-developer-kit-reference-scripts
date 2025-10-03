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
import { Separator } from '@/components/ui/separator'

export interface Model {
  name: string
  value: string
  type: string
}

export interface SpeechToTextSettings {
  sttModel: Model
  sttDevice: string
  denoiseModel: Model
  denoiseDevice: string
}

interface SettingsModalProps {
  task: string
  isOpen: boolean
  onClose: () => void
  updateSettings: (settings: SpeechToTextSettings) => Promise<unknown>
  availableSTTModels: Model[]
  availableDenoiseModels: Model[]
  selectedSTTModel: string
  selectedSTTDevice: string
  selectedDenoiseModel: string
  selectedDenoiseDevice: string
}

export function SettingsModal({
  task,
  isOpen,
  onClose,
  availableSTTModels,
  availableDenoiseModels,
  selectedSTTModel,
  selectedSTTDevice,
  selectedDenoiseModel,
  selectedDenoiseDevice,
  updateSettings,
}: SettingsModalProps) {
  const [tempSTTModel, setTempSTTModel] = useState(selectedSTTModel || '')
  const [tempSTTDevice, setTempSTTDevice] = useState(selectedSTTDevice || 'CPU')
  const [tempDenoiseModel, setTempDenoiseModel] = useState(
    selectedDenoiseModel || '',
  )
  const [tempDenoiseDevice, setTempDenoiseDevice] = useState(
    selectedDenoiseDevice || 'CPU',
  )
  const [tabValue, setTabValue] = useState('predefined')
  const [isLoading, setIsLoading] = useState(false)
  const { data: devices } = useAccelerator()

  const handleSave = () => {
    let sttModel = {
      name: tempSTTModel,
      value: tempSTTModel,
      type: 'custom',
    }
    setIsLoading(true)
    if (tabValue !== 'custom') {
      const selected = availableSTTModels.find(
        (model) => model.value === tempSTTModel,
      )
      if (selected) {
        sttModel = selected
      }
    }

    // Handle denoise model
    let denoiseModel = {
      name: tempDenoiseModel,
      value: tempDenoiseModel,
      type: 'predefined',
    }
    const selectedDenoise = availableDenoiseModels.find(
      (model) => model.value === tempDenoiseModel,
    )
    if (selectedDenoise) {
      denoiseModel = selectedDenoise
    }

    const settings: SpeechToTextSettings = {
      sttModel,
      sttDevice: tempSTTDevice,
      denoiseModel,
      denoiseDevice: tempDenoiseDevice,
    }

    updateSettings(settings).then(() => {
      setIsLoading(false)
      onClose()
    })
  }

  const handleTabChange = (value: string) => {
    setTabValue(value)
    if (value === 'predefined') {
      if (!tempSTTModel) setTempSTTModel(selectedSTTModel)
    } else {
      setTempSTTModel('')
    }
  }

  useEffect(() => {
    setTempSTTModel(selectedSTTModel || availableSTTModels[0].name)
  }, [availableSTTModels, selectedSTTModel])

  useEffect(() => {
    setTempSTTDevice(selectedSTTDevice || 'CPU')
  }, [selectedSTTDevice])

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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <FileSearch className="h-5 w-5" />
            {task} Settings
          </DialogTitle>
        </DialogHeader>

        {/* <div className="space-y-6"> */}
        <div>
          <Label className="text-base font-medium">Speech-To-Text</Label>
          <Tabs
            value={tabValue}
            onValueChange={handleTabChange}
            defaultValue="custom"
            className="mt-2 w-full"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="predefined">Verified Models</TabsTrigger>
              <TabsTrigger value="custom">Custom Model</TabsTrigger>
            </TabsList>

            <TabsContent value="predefined" className="space-y-4">
              <div>
                <Label htmlFor="model-select" className="text-base font-medium">
                  Model
                </Label>
                <Select value={tempSTTModel} onValueChange={setTempSTTModel}>
                  <SelectTrigger className="mt-2 w-full">
                    <SelectValue placeholder="Choose a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSTTModels.map((model) => (
                      <SelectItem key={model.name} value={model.value}>
                        <div className="flex flex-col">
                          <span className="font-medium">{model.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <DeviceSelector
                value={tempSTTDevice}
                onChange={setTempSTTDevice}
              />
            </TabsContent>

            <TabsContent value="custom" className="space-y-4">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="custom-url" className="text-base font-medium">
                    Model Name
                  </Label>
                  <Input
                    id="custom-url"
                    placeholder="OpenVINO/whisper-tiny-int8-ov"
                    value={tempSTTModel}
                    onChange={(e) => setTempSTTModel(e.target.value)}
                    className="mt-2"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    Enter the Hugging Face model name (e.g.,
                    openai/whisper-base)
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                <h4 className="mb-2 flex items-center gap-2 font-medium text-orange-900">
                  <ExternalLink className="h-4 w-4" />
                  Hugging Face Setup
                </h4>
                <div className="space-y-2 text-sm text-orange-800">
                  <p>To use custom speech-to-text models:</p>
                  <ol className="ml-2 list-inside list-decimal space-y-1">
                    <li>Get your API key from Hugging Face (if needed)</li>
                    <li>Add it as HF_TOKEN in your environment</li>
                    <li>
                      Ensure the model supports automatic speech recognition
                    </li>
                    <li>Compatible models include Whisper variants</li>
                  </ol>
                </div>
              </div>

              <DeviceSelector
                value={tempSTTDevice}
                onChange={setTempSTTDevice}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* TODO: The following Separator and Denoise settings section are intentionally hidden for future implementation. Remove or enable if the feature is needed. */}
        <Separator className="hidden" />

        <div className="hidden">
          <Label className="text-base font-medium">Denoise</Label>
          <div className="mt-2 space-y-4">
            <div>
              <Label
                htmlFor="denoise-model-select"
                className="text-base font-medium"
              >
                Model
              </Label>
              <Select
                value={tempDenoiseModel}
                onValueChange={setTempDenoiseModel}
              >
                <SelectTrigger className="mt-2 w-full">
                  <SelectValue placeholder="Choose a model" />
                </SelectTrigger>
                <SelectContent>
                  {availableDenoiseModels.map((model) => (
                    <SelectItem key={model.name} value={model.value}>
                      <div className="flex flex-col">
                        <span className="font-medium">{model.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DeviceSelector
              value={tempDenoiseDevice}
              onChange={setTempDenoiseDevice}
            />
          </div>
        </div>
        {/* </div> */}

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
