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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FileSearch, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Separator } from '@/components/ui/separator'
import { Model, SpeechToTextSettings } from '@/types/workload'
import { DeviceSelector } from '../../common/device-selector'
import {
  ModelSource,
  ModelSourceSelector,
} from '../../common/model-source-selector'
import { ModelSelector } from '@/components/common/model-selector'

interface SettingsModalProps {
  task: string
  isOpen: boolean
  onClose: () => void
  updateSettings: (settings: SpeechToTextSettings) => Promise<unknown>
  availableModels: { [k: string]: Model[] }
  currentSettings: SpeechToTextSettings
}

export function SettingsModal({
  task,
  isOpen,
  onClose,
  availableModels: { stt: availableSTTModels, denoise: availableDenoiseModels },
  currentSettings: {
    sttModel: selectedSTTModel,
    denoiseModel: selectedDenoiseModel,
  },
  updateSettings,
}: SettingsModalProps) {
  const [tempSTTModelName, setTempSTTModelName] = useState(
    selectedSTTModel.name,
  )
  const [tempSTTDevice, setTempSTTDevice] = useState(selectedSTTModel.device)
  const [tempSTTSource, setTempSTTSource] = useState<ModelSource>(
    (selectedSTTModel.source as ModelSource) || 'huggingface',
  )
  const [tempDenoiseModelName, setTempDenoiseModelName] = useState(
    selectedDenoiseModel.name || '',
  )
  const [tempDenoiseDevice, setTempDenoiseDevice] = useState(
    selectedDenoiseModel.device,
  )
  const [tabValue, setTabValue] = useState('predefined')
  const [isLoading, setIsLoading] = useState(false)

  const handleSave = () => {
    let sttModel: Model = {
      name: tempSTTModelName,
      device: tempSTTDevice,
      source: tempSTTSource,
    }
    setIsLoading(true)
    if (tabValue !== 'custom') {
      const selected = availableSTTModels.find(
        (model) => model.name === tempSTTModelName,
      )
      if (selected) {
        sttModel = { ...selected, device: tempSTTDevice, source: tempSTTSource }
      }
    }

    // Handle denoise model
    let denoiseModel = {
      name: tempDenoiseModelName,
      device: tempDenoiseDevice,
      source: tempSTTSource,
    }
    const selectedDenoise = availableDenoiseModels.find(
      (model) => model.name === tempDenoiseModelName,
    )
    if (selectedDenoise) {
      denoiseModel = {
        ...selectedDenoise,
        device: tempDenoiseDevice,
        source: tempSTTSource,
      }
    }

    const settings: SpeechToTextSettings = {
      sttModel,
      denoiseModel,
    }

    updateSettings(settings).then(() => {
      setIsLoading(false)
      onClose()
    })
  }

  const handleTabChange = (value: string) => {
    setTabValue(value)
    if (value === 'predefined') {
      if (!tempSTTModelName) setTempSTTModelName(selectedSTTModel.name)
    } else {
      setTempSTTModelName('')
      setTempSTTDevice('CPU')
    }
  }

  useEffect(() => {
    setTempSTTModelName(selectedSTTModel.name || availableSTTModels[0].name)
  }, [availableSTTModels, selectedSTTModel])

  useEffect(() => {
    setTempSTTDevice(selectedSTTModel.device || 'CPU')
  }, [selectedSTTModel])

  const VerfiedModelsElement = () => (
    <>
      <ModelSourceSelector value={tempSTTSource} onChange={setTempSTTSource} />
      <div>
        <Label htmlFor="model-select" className="text-base font-medium">
          Model
        </Label>
        <Select
          value={tempSTTModelName}
          onValueChange={(value) => setTempSTTModelName(value)}
        >
          <SelectTrigger className="mt-2 w-full">
            <SelectValue placeholder="Choose a model" />
          </SelectTrigger>
          <SelectContent>
            {availableSTTModels.map((model) => (
              <SelectItem key={model.name} value={model.name}>
                <div className="flex flex-col">
                  <span className="font-medium">{model.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DeviceSelector value={tempSTTDevice} onChange={setTempSTTDevice} />
    </>
  )

  const CustomModelElement = () => (
    <>
      <div className="space-y-4">
        <ModelSourceSelector
          value={tempSTTSource}
          onChange={setTempSTTSource}
        />
        <div>
          <Label htmlFor="custom-url" className="text-base font-medium">
            Model Name
          </Label>
          <Input
            id="custom-url"
            placeholder="OpenVINO/whisper-tiny-int8-ov"
            value={tempSTTModelName}
            onChange={(e) => setTempSTTModelName(e.target.value)}
            className="mt-2"
          />
          <p className="mt-1 text-sm text-gray-500">
            Enter the Hugging Face model name (e.g., openai/whisper-base)
          </p>
        </div>
      </div>

      <DeviceSelector value={tempSTTDevice} onChange={setTempSTTDevice} />
    </>
  )

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
          <ModelSelector
            tabValue={tabValue}
            onTabChange={handleTabChange}
            verifiedElement={<VerfiedModelsElement />}
            customElement={<CustomModelElement />}
          />
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
                value={tempDenoiseModelName}
                onValueChange={(value) => setTempDenoiseModelName(value)}
              >
                <SelectTrigger className="mt-2 w-full">
                  <SelectValue placeholder="Choose a model" />
                </SelectTrigger>
                <SelectContent>
                  {availableDenoiseModels.map((model) => (
                    <SelectItem key={model.name} value={model.name}>
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
