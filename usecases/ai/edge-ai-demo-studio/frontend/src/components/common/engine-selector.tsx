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
import { InferenceEngine } from '@/types/workload'
import { Workload } from '@/payload-types'

interface EngineSelectorProps {
  value: Workload['engine']
  onChange: (value: Workload['engine']) => void
  engines: InferenceEngine[]
}

export function EngineSelector({
  value,
  onChange,
  engines,
}: EngineSelectorProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="engine-select" className="text-sm font-medium">
        Inference Engine
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose an engine" />
        </SelectTrigger>
        <SelectContent>
          {engines.map((engine) => (
            <SelectItem key={engine.id} value={engine.id}>
              <div className="flex flex-col">
                <span className="font-medium">{engine.name}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
