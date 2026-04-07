// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ModelList, ModelTypes } from '@/types/workload'
import { Workload } from '@/payload-types'
import {
  useOpenVINOAccelerator,
  useVulkanAccelerator,
} from '@/hooks/use-accelerators'
import { DeviceSelector } from '@/components/common/device-selector'
import { LlamaCppModel } from './model-selector/llamacpp-model'
import { ModelSourceSelector } from '@/components/common/model-source-selector'
import { ModelSelector } from '../model-selector'
import { Accelerator } from '@/types/accelerator'
import { OpenVINOModel } from './model-selector/openvino-model'

interface WorkloadModelConfigurationProps {
  title?: string
  task: string
  modelType: ModelTypes
  engine: Workload['engine']

  // Model Lists
  verifiedModels: ModelList
  customModels: ModelList

  // State
  selectedModel: string
  onModelSelect: (value: string) => void
  device: string
  onDeviceChange: (value: string) => void
  tabValue: string
  onTabChange: (value: string) => void
  source: 'huggingface' | 'modelscope' | 'custom'
  onSourceChange: (value: 'huggingface' | 'modelscope' | 'custom') => void

  // Validation & Extra
  isValid?: boolean
  onValidationChange?: (isValid: boolean) => void
  onDeleteModel?: (id: string, e: React.MouseEvent) => void
  savedModelName?: string
  savedModelType?: 'verified' | 'custom'
  onTempFileUpload?: (tempFilePath: string) => void // For local files if supported

  // Extra Params
  extraParams?: string
  onExtraParamsChange?: (value: string) => void
}

interface CustomModelElementProps {
  engine: Workload['engine']
  selectedModel: string
  onModelSelect: (value: string) => void
  onSourceChange: (value: 'huggingface' | 'modelscope' | 'custom') => void
  device: string
  onDeviceChange: (value: string) => void
  devices: Accelerator[]
  task: string
  modelType: ModelTypes
  customModels: ModelList
  onValidationChange?: (isValid: boolean) => void
  onDeleteModel?: (id: string, e: React.MouseEvent) => void
  source: 'huggingface' | 'modelscope' | 'custom'
  onTempFileUpload?: (tempFilePath: string) => void
  modelExists: boolean
  extraParams?: string
  onExtraParamsChange?: (value: string) => void
}

interface VerifiedModelsElementProps {
  source: 'huggingface' | 'modelscope' | 'custom'
  onSourceChange: (value: 'huggingface' | 'modelscope' | 'custom') => void
  verifiedModels: ModelList
  selectedModel: string
  onModelSelect: (value: string) => void
  device: string
  onDeviceChange: (value: string) => void
  devices: Accelerator[]
}

const VerifiedModelsElement = ({
  source,
  onSourceChange,
  verifiedModels,
  selectedModel,
  onModelSelect,
  device,
  onDeviceChange,
  devices,
}: VerifiedModelsElementProps) => (
  <>
    <ModelSourceSelector
      value={source}
      onChange={onSourceChange}
      label={null}
    />
    {verifiedModels.length === 0 ? (
      <div className="text-muted-foreground rounded-md border border-dashed p-4 text-center text-sm">
        No verified models available
      </div>
    ) : (
      <div className="space-y-2">
        <Label>Select Model</Label>
        <Select value={selectedModel} onValueChange={onModelSelect}>
          <SelectTrigger
            className="w-full"
            data-testid="model-selector-trigger"
          >
            <SelectValue placeholder="Choose a model" />
          </SelectTrigger>
          <SelectContent>
            {verifiedModels.map((m) => (
              <SelectItem
                key={m.id}
                value={m.id}
                data-testid={`model-option-${m.id}`}
              >
                <div className="flex flex-col">
                  <span className="font-medium">{m.id}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )}
    <DeviceSelector
      value={device}
      onChange={onDeviceChange}
      devices={devices}
    />
  </>
)

const CustomModelElement = ({
  engine,
  selectedModel,
  onModelSelect,
  onSourceChange,
  device,
  onDeviceChange,
  devices,
  task,
  modelType,
  customModels,
  onValidationChange,
  onDeleteModel,
  source,
  onTempFileUpload,
  modelExists,
  extraParams,
  onExtraParamsChange,
}: CustomModelElementProps) => (
  <>
    {engine === 'openvino' ? (
      <OpenVINOModel
        modelName={selectedModel}
        onModelNameChange={onModelSelect}
        onSourceChange={onSourceChange}
        task={task}
        type={modelType}
        existingModels={customModels}
        onValidationChange={onValidationChange}
        onDeleteModel={onDeleteModel}
        source={source}
        onTempFileUpload={onTempFileUpload}
        modelExists={modelExists}
        extraParams={extraParams}
        onExtraParamsChange={onExtraParamsChange}
      />
    ) : (
      <LlamaCppModel
        modelName={selectedModel}
        onModelNameChange={onModelSelect}
        onSourceChange={onSourceChange}
        task={task}
        type={modelType}
        onValidationChange={onValidationChange}
        existingModels={customModels}
        onDeleteModel={onDeleteModel}
        source={source}
        onTempFileUpload={onTempFileUpload}
        modelExists={modelExists}
      />
    )}
    <DeviceSelector
      value={device}
      onChange={onDeviceChange}
      devices={devices}
    />
  </>
)

export function WorkloadModelConfiguration({
  title,
  task,
  modelType,
  engine,
  verifiedModels,
  customModels,
  selectedModel,
  onModelSelect,
  device,
  onDeviceChange,
  tabValue,
  onTabChange,
  source,
  onSourceChange,
  onValidationChange,
  onDeleteModel,
  savedModelName,
  savedModelType,
  onTempFileUpload,
  extraParams,
  onExtraParamsChange,
}: WorkloadModelConfigurationProps) {
  const { data: openVINODevices } = useOpenVINOAccelerator()
  const { data: vulkanDevices } = useVulkanAccelerator()

  const devices = engine === 'llamacpp' ? vulkanDevices : openVINODevices
  const modelExists = customModels.some((m) => m.id === selectedModel)

  // Logic to determine initial tab selection logic helpers
  const handleTabChange = (value: string) => {
    onTabChange(value)

    // Auto-select model when switching tabs logic
    if (value === 'predefined') {
      const isVerified = verifiedModels.some((m) => m.id === savedModelName)
      // If we have a saved model that is verified, stick to it, otherwise default to first
      if (isVerified && savedModelName) {
        onModelSelect(savedModelName)
      } else {
        onModelSelect(verifiedModels[0]?.id || '')
      }
    } else {
      // Switching to custom
      const isCustom =
        customModels.some((m) => m.id === savedModelName) ||
        (!verifiedModels.some((m) => m.id === savedModelName) &&
          !!savedModelName)

      if (isCustom && savedModelName) {
        onModelSelect(savedModelName)
      } else {
        onModelSelect('')
        if (onTempFileUpload) onTempFileUpload('')
      }
    }
  }
  const content = (
    <ModelSelector
      savedModelType={savedModelType}
      tabValue={tabValue}
      onTabChange={handleTabChange}
      verifiedElement={
        <VerifiedModelsElement
          verifiedModels={verifiedModels}
          selectedModel={selectedModel}
          onModelSelect={onModelSelect}
          onSourceChange={onSourceChange}
          device={device}
          onDeviceChange={onDeviceChange}
          devices={devices || []}
          source={source}
        />
      }
      customElement={
        <CustomModelElement
          engine={engine}
          selectedModel={selectedModel}
          onModelSelect={onModelSelect}
          onSourceChange={onSourceChange}
          device={device}
          onDeviceChange={onDeviceChange}
          devices={devices || []}
          task={task}
          modelType={modelType}
          customModels={customModels}
          onValidationChange={onValidationChange}
          onDeleteModel={onDeleteModel}
          source={source}
          onTempFileUpload={onTempFileUpload}
          modelExists={modelExists}
          extraParams={extraParams}
          onExtraParamsChange={onExtraParamsChange}
        />
      }
    />
  )

  if (title) {
    return (
      <div
        className="space-y-4 rounded-lg border bg-slate-50/50 p-4"
        data-testid={`workload-model-configuration-${title}`}
      >
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {content}
      </div>
    )
  }

  return content
}
