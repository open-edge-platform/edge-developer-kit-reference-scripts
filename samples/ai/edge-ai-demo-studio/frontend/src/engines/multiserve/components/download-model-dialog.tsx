// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, Plus, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { KNOWN_QUANTIZATIONS } from '@/engines/multiserve/config'
import type { BackendId } from '@/engines/multiserve/types'
import {
  isKnownWeightFormat,
  isOpenVINONativeModel,
  validateModelName,
} from '@/engines/multiserve/validation'

const SERVICE_TASK_MAP: Record<string, string[]> = {
  'text-generation': ['text_generation', 'multimodal'],
  embeddings: ['embeddings'],
  rerank: ['rerank'],
}

interface DownloadModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serviceId: string
  backend: BackendId
  existingModelIds: string[]
  onDownload: (params: {
    backend: BackendId
    repoId: string
    task: string
    weightFormat?: string
    additionalParams?: string
  }) => void
  isDownloading: boolean
}

export function DownloadModelDialog({
  open,
  onOpenChange,
  serviceId,
  backend,
  existingModelIds,
  onDownload,
  isDownloading,
}: DownloadModelDialogProps) {
  const [modelId, setModelId] = useState('')
  const [taskType, setTaskType] = useState(() => {
    const tasks = SERVICE_TASK_MAP[serviceId]
    return tasks?.[0] ?? 'text_generation'
  })
  const [weightFormat, setWeightFormat] = useState('')
  const [additionalParams, setAdditionalParams] = useState('')

  const availableTasks = useMemo(
    () => SERVICE_TASK_MAP[serviceId] ?? ['text_generation'],
    [serviceId],
  )

  const validationError = useMemo(() => {
    if (!modelId.trim()) return ''
    if (!validateModelName(modelId, backend)) {
      return backend === 'llamacpp'
        ? 'Must follow org/model-GGUF:quant format (e.g. Qwen/Qwen3-4B-GGUF:Q5_0). Quantization is required.'
        : 'Must follow org/model format (e.g. OpenVINO/phi-3-mini-ov).'
    }
    if (existingModelIds.includes(modelId)) {
      return 'This model is already downloaded.'
    }
    return ''
  }, [modelId, backend, existingModelIds])

  const isValid = modelId.trim().length > 0 && !validationError

  const isNonNativeOpenVINO =
    backend === 'openvino' &&
    modelId.trim().length > 0 &&
    validateModelName(modelId, 'openvino') &&
    !isOpenVINONativeModel(modelId)

  const showOpenVINOFields = backend === 'openvino' && modelId.trim().length > 0

  const handleDownload = useCallback(() => {
    if (!isValid) return
    onDownload({
      backend,
      repoId: modelId,
      task: taskType,
      ...(backend === 'openvino' && weightFormat && { weightFormat }),
      ...(backend === 'openvino' && additionalParams && { additionalParams }),
    })
  }, [
    isValid,
    onDownload,
    backend,
    modelId,
    taskType,
    weightFormat,
    additionalParams,
  ])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !isDownloading) {
        setModelId('')
        setWeightFormat('')
        setAdditionalParams('')
      }
      onOpenChange(nextOpen)
    },
    [isDownloading, onOpenChange],
  )

  const placeholder =
    backend === 'llamacpp'
      ? 'Qwen/Qwen3-4B-GGUF:Q5_0'
      : 'OpenVINO/phi-3-mini-ov'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="download-model-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Add Model</DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            Register a model by name. It will be downloaded automatically when
            the service starts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Model ID */}
          <div className="space-y-1.5">
            <Label
              htmlFor="download-model-id"
              className="text-foreground text-xs font-medium"
            >
              Model ID
            </Label>
            <Input
              id="download-model-id"
              data-testid="download-model-id"
              placeholder={placeholder}
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className={`h-9 text-xs ${validationError ? 'border-red-500' : ''}`}
              disabled={isDownloading}
            />
            {validationError ? (
              <p className="flex items-center gap-1 text-[11px] text-red-500">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {validationError}
              </p>
            ) : (
              <p className="text-muted-foreground text-[11px]">
                e.g. {placeholder}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="download-task-type"
              className="text-foreground text-xs font-medium"
            >
              Task Type
            </Label>
            {availableTasks.length === 1 ? (
              <Input
                id="download-task-type"
                value={availableTasks[0]}
                disabled
                className="h-9 text-xs"
              />
            ) : (
              <Select
                value={taskType}
                onValueChange={setTaskType}
                disabled={isDownloading}
              >
                <SelectTrigger id="download-task-type" className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableTasks.map((t) => (
                    <SelectItem key={t} value={t} className="text-xs">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {isNonNativeOpenVINO && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-900 dark:bg-amber-950">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-[11px] text-amber-800 dark:text-amber-200">
                This model does not appear to be in OpenVINO IR format. Please
                provide a weight format below so it can be converted
                automatically.
              </p>
            </div>
          )}

          {showOpenVINOFields && (
            <div className="space-y-1.5">
              <Label
                htmlFor="download-weight-format"
                className="text-foreground text-xs font-medium"
              >
                Weight Format{' '}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input
                id="download-weight-format"
                data-testid="download-weight-format"
                placeholder="e.g., int4, int8, fp16"
                value={weightFormat}
                onChange={(e) => setWeightFormat(e.target.value)}
                className="h-9 text-xs"
                disabled={isDownloading}
              />
              {weightFormat && !isKnownWeightFormat(weightFormat) ? (
                <p className="text-[11px] text-red-500">
                  Unknown format. Known:{' '}
                  {(KNOWN_QUANTIZATIONS as readonly string[]).join(', ')}
                </p>
              ) : (
                <p className="text-muted-foreground text-[11px]">
                  Quantization format for model conversion.
                </p>
              )}
            </div>
          )}

          {showOpenVINOFields && (
            <div className="space-y-1.5">
              <Label
                htmlFor="download-extra-params"
                className="text-foreground text-xs font-medium"
              >
                Extra Parameters{' '}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input
                id="download-extra-params"
                data-testid="download-extra-params"
                placeholder="e.g., --ratio 0.8 --group-size 128"
                value={additionalParams}
                onChange={(e) => setAdditionalParams(e.target.value)}
                className="h-9 text-xs"
                disabled={isDownloading}
              />
              <p className="text-muted-foreground text-[11px]">
                Additional CLI parameters for model conversion.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" disabled={isDownloading}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            data-testid="download-model-submit"
            size="sm"
            onClick={handleDownload}
            disabled={!isValid || isDownloading}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
