// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, Plus, TriangleAlert } from 'lucide-react'
import { useId, useState } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
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
import { tasksFor, defaultTaskFor } from '@/engines/multiserve/constants'
import type { BackendId } from '@/engines/multiserve/types'
import {
  isKnownWeightFormat,
  isOpenVINONativeModel,
  validateModelName,
} from '@/engines/multiserve/validation'

interface DownloadModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The instance the model is added to; its type decides the tasks. */
  instanceKey: string
  backend: BackendId
  existingModelIds: string[]
  /** Called with the model to add; the dialog is cleared for the next one. */
  onDownload: (params: {
    backend: BackendId
    repoId: string
    task: string
    weightFormat?: string
    additionalParams?: string
  }) => void
}

function nameProblem(
  modelId: string,
  backend: BackendId,
  existingModelIds: string[],
): string {
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
}

/**
 * Adds a model by name; it is selected and downloaded when the instance next starts. A non-IR
 * OpenVINO model takes a weight format (and optional parameters) to convert with.
 */
export function DownloadModelDialog({
  open,
  onOpenChange,
  instanceKey,
  backend,
  existingModelIds,
  onDownload,
}: DownloadModelDialogProps) {
  const [modelId, setModelId] = useState('')
  const hintId = useId()
  const [taskType, setTaskType] = useState(() => defaultTaskFor(instanceKey))
  const [weightFormat, setWeightFormat] = useState('')
  const [additionalParams, setAdditionalParams] = useState('')

  const availableTasks = tasksFor(instanceKey) ?? ['text_generation']
  const validationError = nameProblem(modelId, backend, existingModelIds)

  const isValid = modelId.trim().length > 0 && !validationError

  const isNonNativeOpenVINO =
    backend === 'openvino' &&
    modelId.trim().length > 0 &&
    validateModelName(modelId, 'openvino') &&
    !isOpenVINONativeModel(modelId)

  const showOpenVINOFields = backend === 'openvino' && modelId.trim().length > 0

  const clear = () => {
    setModelId('')
    setWeightFormat('')
    setAdditionalParams('')
  }

  const handleDownload = () => {
    if (!isValid) return
    onDownload({
      backend,
      repoId: modelId,
      task: taskType,
      ...(backend === 'openvino' && weightFormat && { weightFormat }),
      ...(backend === 'openvino' && additionalParams && { additionalParams }),
    })
    // The parent closes the dialog itself; the next Add starts blank.
    clear()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) clear()
    onOpenChange(nextOpen)
  }

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
              className="h-9 text-xs"
              aria-invalid={validationError ? true : undefined}
              aria-describedby={hintId}
            />
            {validationError ? (
              <p
                id={hintId}
                className="text-destructive flex items-center gap-1 text-[11px]"
              >
                <AlertCircle aria-hidden="true" className="h-3 w-3 shrink-0" />
                {validationError}
              </p>
            ) : (
              <p id={hintId} className="text-muted-foreground text-[11px]">
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
              <Select value={taskType} onValueChange={setTaskType}>
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
            <InlineNotice
              tone="warning"
              className="items-start"
              icon={
                <TriangleAlert
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0"
                />
              }
            >
              This model does not appear to be in OpenVINO IR format. Please
              provide a weight format below so it can be converted
              automatically.
            </InlineNotice>
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
              />
              {weightFormat && !isKnownWeightFormat(weightFormat) ? (
                <p className="text-destructive text-[11px]">
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
                Conversion Parameters{' '}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input
                id="download-extra-params"
                data-testid="download-extra-params"
                placeholder={
                  'e.g., --extra_quantization_params "--ratio 0.8 --group-size 128"'
                }
                value={additionalParams}
                onChange={(e) => setAdditionalParams(e.target.value)}
                spellCheck={false}
                className="h-9 font-mono text-xs"
              />
              <p className="text-muted-foreground text-[11px]">
                Extra ovms --pull options for the conversion. Quote values that
                contain spaces.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button
            data-testid="download-model-submit"
            size="sm"
            onClick={handleDownload}
            disabled={!isValid}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
