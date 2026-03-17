// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Label } from '@/components/ui/label'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Info, Check, ChevronsUpDown, Trash2, ChevronDown } from 'lucide-react'
import { useState, useEffect } from 'react'
import {
  validateIsOpenVINOModelName,
  validateOpenVINOModelName,
} from '@/utils/model-validation'
import { LocalModel } from './local-model'
import { Input } from '@/components/ui/input'
import { KNOWN_QUANTIZATIONS } from '@/lib/engine/multiserve'
import { ModelTypes } from '@/types/workload'
import { ModelSourceSelector } from '../../model-source-selector'

interface OpenVINOModelProps {
  modelName: string
  onModelNameChange: (value: string) => void
  onSourceChange?: (value: 'huggingface' | 'modelscope' | 'custom') => void
  task: string
  type: ModelTypes
  onValidationChange?: (isValid: boolean) => void
  existingModels?: { id: string }[]
  onDeleteModel?: (id: string, e: React.MouseEvent) => void
  source?: 'huggingface' | 'modelscope' | 'custom'
  onTempFileUpload?: (tempFilePath: string) => void
  modelExists?: boolean
  extraParams?: string
  onExtraParamsChange?: (value: string) => void
}

const validateModelName = (name: string): boolean => {
  return validateOpenVINOModelName(name)
}

export function OpenVINOModel({
  modelName,
  onModelNameChange,
  onSourceChange,
  task,
  type,
  onValidationChange,
  existingModels,
  onDeleteModel,
  source,
  onTempFileUpload,
  modelExists,
  extraParams = '',
  onExtraParamsChange,
}: OpenVINOModelProps) {
  const [internalSource, setInternalSource] = useState<
    'huggingface' | 'modelscope' | 'custom'
  >('huggingface')
  const modelSource = source !== undefined ? source : internalSource

  const [isValid, setIsValid] = useState(true)
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState(modelName)
  const [tempFilePath, setTempFilePath] = useState('')
  const [isExtraParamsOpen, setIsExtraParamsOpen] = useState(false)
  const [weightFormat, setWeightFormat] = useState('')
  const [additionalParams, setAdditionalParams] = useState('')

  useEffect(() => {
    if (extraParams) {
      const match = extraParams.match(/--weight-format\s+(\S+)/)
      if (match) {
        setWeightFormat(match[1])
        const remaining = extraParams
          .replace(/--weight-format\s+\S+/, '')
          .trim()
        setAdditionalParams(remaining)
      } else {
        setWeightFormat('')
        setAdditionalParams(extraParams)
      }
    } else {
      setWeightFormat('')
      setAdditionalParams('')
    }
  }, [extraParams])

  useEffect(() => {
    setInputValue(modelName)
  }, [modelName])

  useEffect(() => {
    let valid = true
    if (modelSource === 'custom') {
      const hasValidName = !!modelName && modelName.trim().length > 0
      const hasFile = !!tempFilePath || !!modelExists
      valid = hasValidName && hasFile && validateOpenVINOModelName(modelName)
    } else {
      // For HuggingFace/ModelScope, allow any valid format
      if (modelName) {
        valid = validateModelName(modelName)
        // If not OpenVINO format, weight format is required
        if (valid && !validateIsOpenVINOModelName(modelName)) {
          valid = !!weightFormat && weightFormat.trim().length > 0
        }
        if (weightFormat) {
          valid = KNOWN_QUANTIZATIONS.includes(weightFormat)
        }
      } else {
        valid = false
      }
    }
    setIsValid(valid)
    onValidationChange?.(valid)
  }, [
    modelName,
    onValidationChange,
    modelSource,
    tempFilePath,
    modelExists,
    weightFormat,
  ])

  const handleTempFileUpload = (path: string) => {
    setTempFilePath(path)
    onTempFileUpload?.(path)
  }

  const handleWeightFormatChange = (value: string) => {
    setWeightFormat(value)
    // Combine weight format with additional params
    const combined = value
      ? `--weight-format ${value} ${additionalParams}`.trim()
      : additionalParams
    onExtraParamsChange?.(combined)
  }

  const handleAdditionalParamsChange = (value: string) => {
    setAdditionalParams(value)
    // Combine weight format with additional params
    const combined = weightFormat
      ? `--weight-format ${weightFormat} ${value}`.trim()
      : value
    onExtraParamsChange?.(combined)
  }

  const handleSourceChange = (
    value: 'huggingface' | 'modelscope' | 'custom',
  ) => {
    setInternalSource(value)
    onSourceChange?.(value)
    // Clear model name when switching sources if needed, or keep it.
    // Switching to custom might keep the name if user wants to upload a file for it.
  }

  return (
    <div className="space-y-4">
      <ModelSourceSelector
        value={modelSource}
        onChange={handleSourceChange}
        includeCustom
      />

      <div>
        <Label htmlFor="ovms-model-name" className="text-base font-medium">
          Model Name
        </Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={`mt-2 w-full justify-between ${!isValid && modelName ? 'border-red-500' : ''}`}
            >
              {modelName ? modelName : 'Select or enter model name...'}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[450px] p-0" align="start">
            <Command>
              <CommandInput
                placeholder="Search or enter model..."
                value={inputValue}
                onValueChange={setInputValue}
              />
              <CommandList>
                <CommandEmpty>
                  <div
                    role="button"
                    tabIndex={0}
                    className="hover:bg-accent m-2 flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed py-4 text-center text-sm"
                    onClick={() => {
                      onModelNameChange(inputValue)
                      setOpen(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onModelNameChange(inputValue)
                        setOpen(false)
                      }
                    }}
                  >
                    {inputValue ? (
                      <>
                        <p>Use &quot;{inputValue}&quot;</p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {modelSource === 'custom'
                            ? 'Enter model name for local file'
                            : `Model will be downloaded from ${modelSource}`}
                        </p>
                      </>
                    ) : (
                      'No models found.'
                    )}
                  </div>
                </CommandEmpty>
                {existingModels && existingModels.length > 0 && (
                  <CommandGroup heading="Saved Models">
                    {existingModels.map((model) => (
                      <CommandItem
                        key={model.id}
                        value={model.id}
                        onSelect={() => {
                          onModelNameChange(model.id)
                          setOpen(false)
                        }}
                        className="group flex items-center justify-between"
                      >
                        <div className="flex items-center">
                          <Check
                            className={cn(
                              'mr-2 h-4 w-4',
                              modelName === model.id
                                ? 'opacity-100'
                                : 'opacity-0',
                            )}
                          />
                          {model.id}
                        </div>
                        {onDeleteModel && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={(e) => {
                              onDeleteModel(model.id.split(':')[0], e)
                            }}
                          >
                            <Trash2 className="text-destructive h-3 w-3" />
                          </Button>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <p
          className={`mt-1 text-sm ${!isValid && modelName ? 'text-red-500' : 'text-gray-500'}`}
        >
          {!isValid && modelName
            ? modelSource === 'custom'
              ? !tempFilePath && !modelExists
                ? 'Please upload a model file below to proceed'
                : 'Invalid format. Use: organization/model (e.g., OpenVINO/model-name)'
              : validateModelName(modelName) &&
                  !validateIsOpenVINOModelName(modelName)
                ? 'Weight format is required for non-OpenVINO models (see below)'
                : 'Invalid format. Use: organization/model (e.g., OpenVINO/model-name)'
            : modelSource === 'custom'
              ? 'Enter a unique identifier for your model in organization/model format (e.g., OpenVINO/model-name)'
              : `Enter the ${modelSource === 'huggingface' ? 'Hugging Face' : 'ModelScope'} model name (e.g., organization/model-name)`}
        </p>
      </div>

      {modelSource !== 'custom' &&
        modelName &&
        validateModelName(modelName) &&
        !validateIsOpenVINOModelName(modelName) && (
          <>
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Note:</strong> This model name doesn&apos;t follow
                OpenVINO naming convention (ending with -ov or -ovz), so it will
                be assumed as a non-OpenVINO format model and requires
                conversion. Please specify the weight format below.
              </p>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="weight-format"
                  className="text-base font-medium"
                >
                  Weight Format *
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">
                      Specify the weight format for model conversion (e.g.,
                      int4, int8, fp16). This is required for non-OpenVINO
                      models.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="weight-format"
                type="text"
                placeholder="e.g., int4, int8, fp16"
                value={weightFormat}
                onChange={(e) => handleWeightFormatChange(e.target.value)}
                className="mt-2"
              />
              {weightFormat && !KNOWN_QUANTIZATIONS.includes(weightFormat) ? (
                <p className="mt-1 text-sm text-red-500">
                  Unknown weight format. Known formats are:{' '}
                  {KNOWN_QUANTIZATIONS.join(', ')}
                </p>
              ) : (
                <p className="mt-1 text-sm text-gray-500">
                  Enter the weight format for converting this model to OpenVINO
                  format
                </p>
              )}
            </div>

            <Collapsible
              open={isExtraParamsOpen}
              onOpenChange={setIsExtraParamsOpen}
            >
              <CollapsibleTrigger>
                <div className="flex items-center gap-2">
                  <Label className="cursor-pointer text-base font-medium">
                    Extra Parameters
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-sm">
                        Optional additional parameters for model conversion
                        (e.g., --ratio 0.8, --group-size 128). These will be
                        combined with the weight format.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-transform duration-200',
                    isExtraParamsOpen && 'rotate-180',
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 pt-2">
                <Input
                  id="additional-params"
                  type="text"
                  placeholder="e.g., --ratio 0.8 --group-size 128"
                  value={additionalParams}
                  onChange={(e) => handleAdditionalParamsChange(e.target.value)}
                />
                <p className="text-sm text-gray-500">
                  Add any additional parameters for model conversion (optional)
                </p>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}

      {modelSource === 'custom' && (
        <LocalModel
          selectedEngine="openvino"
          task={task}
          type={type}
          modelName={modelName}
          onTempFileUpload={handleTempFileUpload}
        />
      )}
    </div>
  )
}
