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
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { Info } from 'lucide-react'

export type ModelSource = 'huggingface' | 'modelscope' | 'custom'

interface ModelSourceSelectorProps {
  value: string
  onChange: (value: ModelSource) => void
  label?: React.ReactNode
  className?: string
  includeCustom?: boolean
}

export function ModelSourceSelector({
  value,
  onChange,
  label = 'Model Source',
  className,
  includeCustom = false,
}: ModelSourceSelectorProps) {
  return (
    <div className={className}>
      {label && (
        <div className="flex items-center gap-2">
          <Label
            htmlFor="model-source-select"
            className="text-base font-medium"
          >
            {label}
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
                <p className="font-medium">
                  {value === 'huggingface' ? 'Hugging Face' : 'ModelScope'}{' '}
                  Setup Setup
                </p>
                <ol className="ml-4 list-decimal space-y-1">
                  <li>
                    Get your API key from{' '}
                    {value === 'huggingface' ? 'Hugging Face' : 'ModelScope'}
                  </li>
                  <li>
                    Add it as{' '}
                    {value === 'huggingface' ? 'HF_TOKEN' : 'MODELSCOPE_TOKEN'}{' '}
                    in your environment
                  </li>
                  <li>Model will be downloaded on first use</li>
                </ol>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      )}
      <Select
        value={value}
        onValueChange={(val) => onChange(val as ModelSource)}
      >
        <SelectTrigger className="mt-2 w-full">
          <SelectValue placeholder="Choose a model source" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="huggingface">Hugging Face</SelectItem>
          <SelectItem value="modelscope">ModelScope</SelectItem>
          {includeCustom && <SelectItem value="custom">Local File</SelectItem>}
        </SelectContent>
      </Select>
      <p className="mt-1 text-sm text-gray-500">
        Select where to download the model from
      </p>
    </div>
  )
}
