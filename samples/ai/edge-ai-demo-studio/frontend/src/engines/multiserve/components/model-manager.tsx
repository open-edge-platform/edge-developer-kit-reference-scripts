// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertCircle,
  Cpu,
  Download,
  Eye,
  HardDrive,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  useEngineHealth,
  useIsEngineStarting,
  useStartEngine,
} from '@/engines/multiserve/hooks/use-engine-health'
import {
  useDeleteModel,
  useMultiserveModels,
  useUploadModel,
} from '@/engines/multiserve/hooks/use-models'
import type {
  BackendId,
  ModelSource,
  ModelUsage,
  MultiserveModel,
} from '@/engines/multiserve/types'
import { DownloadModelDialog } from './download-model-dialog'
import { UploadModelDialog } from './upload-model-dialog'
import { cn } from '@/lib/utils'

// ─── Props ────────────────────────────────────────────────────────

interface ModelManagerProps {
  serviceId: string
  dbId?: number
  backend?: BackendId
  onSelectModel?: (
    repoId: string,
    backend: BackendId,
    taskType: ModelUsage,
    quant?: string,
    verifiedQuant?: string,
    additionalParams?: string,
    source?: ModelSource,
  ) => void
  selectedModel?: string
  selectedAdditionalParams?: string
  selectedSource?: ModelSource
}

const SERVICE_TASK_MAP: Record<string, string[]> = {
  'text-generation': ['text_generation', 'multimodal'],
  embeddings: ['embeddings'],
  rerank: ['rerank'],
}

export function ModelManager({
  serviceId,
  dbId,
  backend,
  onSelectModel,
  selectedModel,
  selectedAdditionalParams,
  selectedSource,
}: ModelManagerProps) {
  const { data: isEngineUp, isLoading: isHealthLoading } =
    useEngineHealth(serviceId)
  const { mutate: startEngine, isPending: isStarting } =
    useStartEngine(serviceId)
  const isEngineStartingAnywhere = useIsEngineStarting()
  const isWaitingForEngine = isStarting || isEngineStartingAnywhere
  const { data, isLoading, isError, error, isFetching } = useMultiserveModels(
    serviceId,
    backend,
    isEngineUp === true,
  )
  const [source, setSource] = useState<ModelSource>(
    selectedSource ?? 'huggingface',
  )
  const [search, setSearch] = useState('')
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)

  const uploadMutation = useUploadModel(serviceId)
  const { mutate: uploadModelFiles } = uploadMutation

  const models = useMemo(() => {
    if (!data) return []
    const allowedTasks = SERVICE_TASK_MAP[serviceId]
    const result: (MultiserveModel & { backend: BackendId })[] = []
    for (const [backendKey, backendModels] of Object.entries(data)) {
      for (const model of backendModels) {
        if (allowedTasks && !allowedTasks.includes(model.task_type)) continue
        result.push({ ...model, backend: backendKey as BackendId })
      }
    }
    return result
  }, [data, serviceId])

  const selectableModels = useMemo(
    () =>
      models.filter((m) => m.downloaded.length > 0 || m.verified.length > 0),
    [models],
  )

  const filteredModels = useMemo(() => {
    if (!search.trim()) return selectableModels
    const q = search.toLowerCase()
    return selectableModels.filter((m) => m.repo_id.toLowerCase().includes(q))
  }, [selectableModels, search])

  const { downloaded, available } = useMemo(() => {
    const sortFn = (
      a: (typeof filteredModels)[0],
      b: (typeof filteredModels)[0],
    ) => {
      if (a.repo_id === selectedModel) return -1
      if (b.repo_id === selectedModel) return 1
      return a.repo_id.localeCompare(b.repo_id)
    }
    const downloaded = filteredModels
      .filter((m) => m.downloaded.length > 0)
      .sort(sortFn)
    const available = filteredModels
      .filter((m) => m.downloaded.length === 0)
      .sort(sortFn)
    return { downloaded, available }
  }, [filteredModels, selectedModel])

  const existingModelIds = useMemo(
    () => models.filter((m) => m.downloaded.length > 0).map((m) => m.repo_id),
    [models],
  )

  const handleSourceChange = useCallback(
    (newSource: ModelSource) => {
      setSource(newSource)
      if (selectedModel) {
        const model = selectableModels.find((m) => m.repo_id === selectedModel)
        if (model) {
          const bestQuant = model.verified[0] ?? model.downloaded[0]
          const verifiedQuant = model.verified[0]
          onSelectModel?.(
            model.repo_id,
            backend ?? model.backend,
            model.task_type === 'multimodal' ? 'multimodal' : 'default',
            bestQuant,
            verifiedQuant,
            selectedAdditionalParams,
            newSource,
          )
        } else {
          onSelectModel?.(
            selectedModel,
            backend ?? 'openvino',
            'default',
            undefined,
            undefined,
            selectedAdditionalParams,
            newSource,
          )
        }
      }
    },
    [
      selectedModel,
      selectableModels,
      backend,
      onSelectModel,
      selectedAdditionalParams,
    ],
  )

  const defaultTask = useMemo(() => {
    const tasks = SERVICE_TASK_MAP[serviceId]
    return tasks?.[0] ?? 'text_generation'
  }, [serviceId])

  const showDraftCard =
    selectedModel != null &&
    selectedModel.trim() !== '' &&
    !selectableModels.some((m) => m.repo_id === selectedModel)

  const handleDownload = useCallback(
    (params: {
      backend: BackendId
      repoId: string
      task: string
      weightFormat?: string
      additionalParams?: string
    }) => {
      onSelectModel?.(
        params.repoId,
        params.backend,
        params.task === 'multimodal' ? 'multimodal' : 'default',
        undefined,
        params.weightFormat,
        params.additionalParams,
        source,
      )
      setDownloadDialogOpen(false)
    },
    [onSelectModel, source],
  )

  const handleUpload = useCallback(
    (params: {
      backend: BackendId
      repoId: string
      task: string
      files: File[]
    }) => {
      uploadModelFiles(
        {
          backend: params.backend,
          repoId: params.repoId,
          task: params.task,
          files: params.files,
        },
        { onSuccess: () => setUploadDialogOpen(false) },
      )
    },
    [uploadModelFiles],
  )

  if (!isEngineUp && !isHealthLoading) {
    return (
      <div className="space-y-2 px-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Model
        </p>
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
          {isWaitingForEngine ? (
            <Loader2 className="text-warning h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <AlertCircle className="text-warning h-4 w-4 shrink-0" />
          )}
          <div className="flex-1 space-y-1.5">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
              {isWaitingForEngine
                ? 'Starting engine\u2026'
                : 'Engine is not running'}
            </p>
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              {isWaitingForEngine
                ? 'Please wait while the engine initializes.'
                : 'Start the engine to load available models.'}
            </p>
            {!isWaitingForEngine && (
              <Button
                data-testid="start-engine-button"
                variant="outline"
                size="sm"
                className="mt-1 h-6 gap-1 text-[10px]"
                disabled={dbId == null}
                onClick={() => dbId != null && startEngine(dbId)}
              >
                <Cpu className="h-3 w-3" />
                Start Engine
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (isLoading || isHealthLoading) {
    return (
      <div className="space-y-2 px-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Model
        </p>
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-8 w-full rounded-md" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="space-y-2 px-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Model
        </p>
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 dark:border-red-900 dark:bg-red-950">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-xs text-red-700 dark:text-red-300">
            {error instanceof Error ? error.message : 'Failed to load models.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 px-2">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Model
          {isFetching && (
            <Loader2 className="text-muted-foreground ml-1.5 inline-block h-3 w-3 animate-spin" />
          )}
        </p>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="add-model-button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground h-6 w-6"
                onClick={() => setDownloadDialogOpen(true)}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">Add model</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="upload-model-button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground h-6 w-6"
                onClick={() => setUploadDialogOpen(true)}
              >
                <Upload className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">Upload local model</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {selectableModels.length > 0 && (
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2" />
          <Input
            data-testid="model-search-input"
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pr-7 pl-7 text-xs"
          />
          {search && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
              onClick={() => setSearch('')}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {filteredModels.length > 0 || showDraftCard ? (
        <div
          data-testid="model-list"
          className="max-h-80 space-y-1 overflow-y-auto pr-0.5"
          role="listbox"
          aria-label="Model list"
        >
          {showDraftCard && (
            <div className="border-primary bg-primary/5 ring-primary/20 flex w-full items-center rounded-md border border-dashed p-2 text-left text-xs ring-1">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-1.5">
                  <Download className="text-primary/70 dark:text-primary/60 h-3.5 w-3.5 shrink-0" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-foreground/80 dark:text-foreground/70 truncate font-medium">
                        {selectedModel}
                      </p>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="text-xs">{selectedModel}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-1">
                  <Badge className="h-4 border-amber-200 bg-amber-100 px-1.5 py-0 text-[10px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                    <Download className="mr-0.5 h-2.5 w-2.5" />
                    Pending download
                  </Badge>
                </div>
              </div>
            </div>
          )}
          {downloaded.length > 0 && available.length > 0 && (
            <p className="text-muted-foreground/70 py-1 text-[10px] font-medium tracking-wider uppercase">
              Ready ({downloaded.length})
            </p>
          )}
          {downloaded.map((model) => (
            <ModelRow
              key={`${model.backend}-${model.repo_id}`}
              model={model}
              serviceId={serviceId}
              isSelected={selectedModel === model.repo_id}
              onSelect={onSelectModel}
              backend={backend}
              source={source}
            />
          ))}
          {available.length > 0 && downloaded.length > 0 && (
            <p className="text-muted-foreground/70 py-1 text-[10px] font-medium tracking-wider uppercase">
              Available ({available.length})
            </p>
          )}
          {available.map((model) => (
            <ModelRow
              key={`${model.backend}-${model.repo_id}`}
              model={model}
              serviceId={serviceId}
              isSelected={selectedModel === model.repo_id}
              onSelect={onSelectModel}
              backend={backend}
              source={source}
            />
          ))}
        </div>
      ) : search ? (
        <div className="text-muted-foreground rounded-md border border-dashed p-3 text-center text-xs">
          No models match &ldquo;{search}&rdquo;
        </div>
      ) : (
        <div className="text-muted-foreground rounded-md border border-dashed p-3 text-center text-xs">
          No models available for this backend
        </div>
      )}

      {/* Source select */}
      <div className="space-y-2">
        <Label className="text-muted-foreground text-xs">Source</Label>
        <div
          data-testid="source-select"
          role="group"
          aria-label="Model source"
          className="flex flex-wrap gap-1.5"
        >
          {(
            [
              { value: 'huggingface', label: 'Hugging Face' },
              { value: 'modelscope', label: 'ModelScope' },
            ] as const
          ).map(({ value, label }) => {
            const isSelected = source === value
            return (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={isSelected ? 'default' : 'outline'}
                onClick={() => handleSourceChange(value as ModelSource)}
                className={cn(
                  'h-7 px-3 text-xs transition-all',
                  isSelected && 'ring-ring ring-1 ring-offset-0',
                )}
              >
                {label}
              </Button>
            )
          })}
        </div>
      </div>

      <DownloadModelDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        serviceId={serviceId}
        backend={backend ?? 'openvino'}
        existingModelIds={existingModelIds}
        onDownload={handleDownload}
        isDownloading={false}
      />

      <UploadModelDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        serviceId={serviceId}
        backend={backend ?? 'openvino'}
        taskType={defaultTask}
        onUpload={handleUpload}
        isUploading={uploadMutation.isPending}
        isUploadSuccess={uploadMutation.isSuccess}
        uploadError={
          uploadMutation.isError ? (uploadMutation.error as Error) : null
        }
      />
    </div>
  )
}

function ModelRow({
  model,
  serviceId,
  isSelected,
  onSelect,
  backend,
  source,
}: {
  model: MultiserveModel & { backend: BackendId }
  serviceId: string
  isSelected: boolean
  onSelect?: (
    repoId: string,
    backend: BackendId,
    taskType: ModelUsage,
    quant?: string,
    verifiedQuant?: string,
    additionalParams?: string,
    source?: ModelSource,
  ) => void
  backend?: BackendId
  source?: ModelSource
}) {
  const isDownloaded = model.downloaded.length > 0
  const isVerified = model.verified.length > 0

  const bestQuant = model.verified[0] ?? model.downloaded[0]
  const verifiedQuant = model.verified[0]

  const allQuants = [...new Set([...model.downloaded, ...model.verified])]

  const { mutate: deleteModel, isPending: isDeleting } =
    useDeleteModel(serviceId)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleDelete = useCallback(() => {
    deleteModel(
      { backend: model.backend, repoId: model.repo_id },
      { onSettled: () => setConfirmOpen(false) },
    )
  }, [deleteModel, model.backend, model.repo_id, setConfirmOpen])

  return (
    <>
      <div
        role="option"
        aria-selected={isSelected}
        aria-busy={isDeleting}
        tabIndex={0}
        className={`relative flex w-full items-center justify-between rounded-md border p-2 text-left text-xs transition-all ${
          isDeleting
            ? 'pointer-events-none opacity-50'
            : isSelected
              ? 'border-primary bg-primary/5 ring-primary/20 ring-1'
              : 'bg-card hover:bg-accent/50'
        } cursor-pointer`}
        onClick={() =>
          !isDeleting &&
          onSelect?.(
            model.repo_id,
            backend ?? model.backend,
            model.task_type === 'multimodal' ? 'multimodal' : 'default',
            bestQuant,
            verifiedQuant,
            undefined,
            source,
          )
        }
        onKeyDown={(e) => {
          if (!isDeleting && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onSelect?.(
              model.repo_id,
              backend ?? model.backend,
              model.task_type === 'multimodal' ? 'multimodal' : 'default',
              bestQuant,
              verifiedQuant,
              undefined,
              source,
            )
          }
        }}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="truncate font-medium">{model.repo_id}</p>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">{model.repo_id}</p>
            </TooltipContent>
          </Tooltip>
          <div className="flex flex-wrap items-center gap-1">
            {isDownloaded ? (
              <Badge className="h-4 bg-green-100 px-1 py-0 text-[10px] text-green-800 dark:bg-green-900 dark:text-green-200">
                <HardDrive className="mr-0.5 h-2.5 w-2.5" />
                Ready
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-muted-foreground h-4 px-1 py-0 text-[10px]"
              >
                Not downloaded
              </Badge>
            )}
            {isVerified && (
              <Badge className="h-4 bg-blue-100 px-1 py-0 text-[10px] text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                <ShieldCheck className="mr-0.5 h-2.5 w-2.5" />
                Verified
              </Badge>
            )}{' '}
            {model.task_type === 'multimodal' && (
              <Badge className="h-4 bg-purple-100 px-1 py-0 text-[10px] text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                <Eye className="mr-0.5 h-2.5 w-2.5" />
                Vision
              </Badge>
            )}
          </div>
          {allQuants.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {allQuants.map((q) => {
                const isQuantVerified = model.verified.includes(q)
                return (
                  <Badge
                    key={q}
                    variant="outline"
                    className={`h-4 px-1 py-0 text-[10px] ${
                      isQuantVerified
                        ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {isQuantVerified && (
                      <ShieldCheck className="mr-0.5 h-2.5 w-2.5" />
                    )}
                    {q}
                  </Badge>
                )
              })}
            </div>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-testid="delete-model-button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive h-6 w-6 shrink-0"
              disabled={!isDownloaded || isDeleting}
              onClick={(e) => {
                e.stopPropagation()
                setConfirmOpen(true)
              }}
            >
              {isDeleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isDownloaded ? 'Delete model from disk' : 'Model not downloaded'}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => !isDeleting && setConfirmOpen(open)}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isDeleting ? 'Deleting Model…' : 'Delete Model'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isDeleting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Removing{' '}
                  <span className="text-foreground font-medium">
                    {model.repo_id}
                  </span>{' '}
                  from disk…
                </span>
              ) : (
                <>
                  Are you sure you want to delete{' '}
                  <span className="text-foreground font-medium">
                    {model.repo_id}
                  </span>
                  ? This will remove the model files from disk.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-sm" disabled={isDeleting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="delete-model-confirm"
              className={buttonVariants({ variant: 'destructive', size: 'sm' })}
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
