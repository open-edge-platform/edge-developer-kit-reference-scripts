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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { MessageSquareText, Info, Loader2 } from 'lucide-react'
import { useState } from 'react'
import {
  useOpenVINOAccelerator,
  usePytorchAccelerator,
} from '@/hooks/use-accelerators'
import { TTS_MODELS } from '@/lib/workloads/text-to-speech'
import { TTSSettings } from '@/types/workload'
import { DeviceSelector } from '../../common/device-selector'
import {
  ModelSource,
  ModelSourceSelector,
} from '../../common/model-source-selector'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  updateSettings: (settings: TTSSettings) => Promise<unknown>
  currentSettings: TTSSettings
}

export function SettingsModal({
  isOpen,
  onClose,
  currentSettings,
  updateSettings,
}: SettingsModalProps) {
  const [tempModel, setTempModel] = useState<TTSSettings['model']>(
    currentSettings.model,
  )
  const [tempSource, setTempSource] = useState<ModelSource>(
    (currentSettings.model.source as ModelSource) || 'huggingface',
  )
  const [isLoading, setIsLoading] = useState(false)
  const { data: pytorchDevices } = usePytorchAccelerator()
  const { data: ovDevices } = useOpenVINOAccelerator()

  // Get current model info
  const currentModel = TTS_MODELS.find(
    (model) => model.model === tempModel.name,
  )

  // Get available languages for the current model
  const availableLanguages = currentModel
    ? Array.isArray(currentModel.languages)
      ? currentModel.languages
      : [currentModel.languages]
    : []

  // Get available devices based on model type and cpuOnly constraint
  const getAvailableDevices = () => {
    if (!currentModel) return []

    const allDevices =
      currentModel.type === 'PyTorch' ? pytorchDevices : ovDevices
    const devices = allDevices || []

    // If model is cpuOnly, filter to only show CPU devices
    if (currentModel.cpuOnly) {
      return devices.filter(
        (device) =>
          device.id.toUpperCase() === 'CPU' ||
          device.name.toUpperCase().includes('CPU'),
      )
    }

    return devices
  }

  const availableDevices = getAvailableDevices()

  const [prevDeps, setPrevDeps] = useState({
    isOpen: isOpen,
    settings: currentSettings,
  })

  if (isOpen !== prevDeps.isOpen || currentSettings !== prevDeps.settings) {
    setPrevDeps({ isOpen: isOpen, settings: currentSettings })
    if (isOpen) {
      setTempModel(currentSettings.model)
      setTempSource(currentSettings.model.source || 'huggingface')
    }
  }

  const handleModelChange = (modelName: string) => {
    const selectedModel = TTS_MODELS.find((model) => model.model === modelName)
    if (selectedModel) {
      // Get available devices for the new model
      const allDevices =
        selectedModel.type === 'PyTorch' ? pytorchDevices : ovDevices
      const devices = allDevices || []

      let availableDevicesForModel = devices
      if (selectedModel.cpuOnly) {
        availableDevicesForModel = devices.filter(
          (device) =>
            device.id.toUpperCase() === 'CPU' ||
            device.name.toUpperCase().includes('CPU'),
        )
      }

      // Check if current device is still available, otherwise use first available device
      const currentDeviceAvailable = availableDevicesForModel.some(
        (device) => device.id === tempModel.device,
      )
      const defaultDevice = currentDeviceAvailable
        ? tempModel.device
        : availableDevicesForModel[0]?.id || 'CPU'

      setTempModel({
        name: modelName,
        device: defaultDevice,
      })
    }
  }

  const handleDeviceChange = (device: string) => {
    setTempModel({ ...tempModel, device })
  }

  const handleSave = () => {
    setIsLoading(true)
    updateSettings({ model: { ...tempModel, source: tempSource } })
      .then(() => {
        setIsLoading(false)
        onClose()
      })
      .catch(() => {
        setIsLoading(false)
      })
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="sm:max-w-[700px]"
        data-testid="tts-settings-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <MessageSquareText className="h-5 w-5" />
            Text-to-Speech Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Model Source */}
          <ModelSourceSelector value={tempSource} onChange={setTempSource} />

          {/* Model Selection */}
          <div className="space-y-3">
            <Label className="text-base font-medium">TTS Model</Label>
            <Select value={tempModel.name} onValueChange={handleModelChange}>
              <SelectTrigger className="w-full" data-testid="tts-model-trigger">
                <SelectValue placeholder="Select TTS model" />
              </SelectTrigger>
              <SelectContent>
                {TTS_MODELS.map((modelInfo) => {
                  return (
                    <SelectItem key={modelInfo.model} value={modelInfo.model}>
                      {modelInfo.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="space-y-2 text-sm">
                <div>
                  <strong>Selected Model:</strong>{' '}
                  {currentModel?.label || 'N/A'}
                </div>
                <div>
                  <strong>
                    Supported Languages ({availableLanguages.length}):
                  </strong>
                  <div className="mt-1 max-h-24 overflow-y-auto">
                    {availableLanguages.length > 0 ? (
                      <div className="grid grid-cols-1 gap-1">
                        {availableLanguages.map((lang, index) => (
                          <div
                            key={lang.id || index}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="font-medium">{lang.name}</span>
                            <span className="text-muted-foreground">
                              {lang.voices.length} voice
                              {lang.voices.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        No languages available
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <strong>Total Voices:</strong>{' '}
                  {availableLanguages.reduce(
                    (acc, lang) => acc + lang.voices.length,
                    0,
                  )}
                </div>
              </AlertDescription>
            </Alert>
          </div>

          {/* Device Selection */}
          <div className="space-y-3">
            <DeviceSelector
              label="Processing Device"
              value={tempModel.device}
              onChange={handleDeviceChange}
              devices={availableDevices}
            />

            {currentModel?.cpuOnly && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  <strong>CPU Only Model:</strong> This model only supports CPU
                  processing. GPU options are filtered out.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        <div className="flex justify-end space-x-2 border-t pt-4">
          <Button variant="outline" disabled={isLoading} onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isLoading}
            className="bg-blue-600 text-white"
            data-testid="settings-save-button"
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
