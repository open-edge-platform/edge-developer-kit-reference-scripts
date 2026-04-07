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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { AlertCircle, Info, Check, ChevronsUpDown, Trash2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { validateLlamaCPPModelName } from '@/utils/model-validation'
import { LocalModel } from './local-model'
import { ModelTypes } from '@/types/workload'
import { ModelSourceSelector } from '../../model-source-selector'

interface LlamaCppModelProps {
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
}

export function LlamaCppModel({
  modelName,
  onModelNameChange,
  onSourceChange,
  onValidationChange,
  existingModels,
  onDeleteModel,
  source,
  task,
  type,
  onTempFileUpload,
  modelExists,
}: LlamaCppModelProps) {
  const [internalSource, setInternalSource] = useState<
    'huggingface' | 'modelscope' | 'custom'
  >('huggingface')
  const modelSource = source !== undefined ? source : internalSource

  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState(modelName)
  const [tempFilePath, setTempFilePath] = useState('')

  useEffect(() => {
    setInputValue(modelName)
  }, [modelName])

  const handleSourceChange = (
    value: 'huggingface' | 'modelscope' | 'custom',
  ) => {
    setInternalSource(value)
    onSourceChange?.(value)
  }

  const handleModelNameChange = (value: string) => {
    onModelNameChange(value)
  }

  const validateModelName = (name: string): boolean => {
    return validateLlamaCPPModelName(name)
  }

  const isValidGguf = () => {
    return validateModelName(modelName)
  }

  useEffect(() => {
    let valid = true
    if (modelSource === 'custom') {
      // For custom source: model name must be valid AND (file uploaded OR model exists)
      const hasValidName = !!modelName && modelName.trim().length > 0
      const hasFile = !!tempFilePath || !!modelExists
      valid = hasValidName && hasFile
    } else {
      valid = !modelName || validateModelName(modelName)
    }
    onValidationChange?.(valid)
  }, [modelName, onValidationChange, modelSource, tempFilePath, modelExists])

  const handleTempFileUpload = (path: string) => {
    setTempFilePath(path)
    onTempFileUpload?.(path)
  }

  return (
    <div className="space-y-4">
      <ModelSourceSelector
        value={modelSource}
        onChange={handleSourceChange}
        includeCustom
      />

      <div>
        <div className="flex items-center gap-2">
          <Label
            htmlFor="llamacpp-model-name"
            className="text-base font-medium"
          >
            Model Name (GGUF)
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
              <div className="space-y-2 text-sm">
                <p className="font-medium">GGUF Format Required</p>
                <p>llama.cpp only supports GGUF format models:</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>Model must be in GGUF format</li>
                  <li>
                    Look for model names containing &quot;GGUF&quot; or
                    &quot;gguf&quot;
                  </li>
                  <li>Common quantizations: Q4_K_M, Q5_K_M, Q8_0, etc.</li>
                  <li>
                    Format: name/model_name or name/model_name:quantization
                  </li>
                  <li>Example: Qwen/Qwen3-4B-GGUF:Q5_0</li>
                </ul>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              data-testid="llamacpp-model-trigger"
              className={`mt-2 w-full justify-between ${!isValidGguf() && modelName ? 'border-red-500' : ''}`}
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
                data-testid="llamacpp-model-input"
              />
              <CommandList>
                <CommandEmpty>
                  <div
                    role="button"
                    tabIndex={0}
                    className="hover:bg-accent m-2 flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed py-4 text-center text-sm"
                    onClick={() => {
                      handleModelNameChange(inputValue)
                      setOpen(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleModelNameChange(inputValue)
                        setOpen(false)
                      }
                    }}
                  >
                    {inputValue ? (
                      <>
                        <p>Use &quot;{inputValue}&quot;</p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {modelSource === 'custom'
                            ? 'Enter model name for local GGUF file'
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
                          handleModelNameChange(model.id)
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
                              onDeleteModel(model.id, e)
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
        <p className="mt-1 text-sm text-gray-500">
          {modelSource === 'custom'
            ? 'Enter a unique identifier for your GGUF model (e.g., ggml-org/Qwen3-8B-GGUF)'
            : 'Format: name/model_name or name/model_name:quantization (must contain "gguf")'}
        </p>
        {!isValidGguf() &&
          (modelName ? (
            <div className="mt-2 flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="h-4 w-4" />
              <span>
                Model name must follow format name/model_name or
                name/model_name:quantz and contain &quot;gguf&quot;
              </span>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="h-4 w-4" />
              <span>Model name cannot be empty</span>
            </div>
          ))}
      </div>

      {modelSource === 'custom' && (
        <LocalModel
          selectedEngine="llamacpp"
          task={task}
          type={type}
          modelName={modelName}
          onTempFileUpload={handleTempFileUpload}
        />
      )}
    </div>
  )
}
