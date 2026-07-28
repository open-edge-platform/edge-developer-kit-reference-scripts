// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Download, ImageIcon, Loader2, Sparkles, Upload } from 'lucide-react'
import Image from 'next/image'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { UploadButton } from '@/components/common/upload-button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import type { Service } from '@/services/types'
import { demoConfig } from './config'
import { useEditImage } from './hooks/use-edit-image'
import type { TaskStatus } from './hooks/use-generate-image'
import { useGenerateImage } from './hooks/use-generate-image'
import { useImageGenParams } from './hooks/use-params'

function ImageOutput({
  images,
  isPending,
  label,
  resolution,
  'data-testid': testId,
  errorMessage,
}: {
  images: string[]
  isPending: boolean
  label: string
  resolution: string
  'data-testid'?: string
  errorMessage?: string
}) {
  const downloadImage = (src: string, index: number) => {
    const link = document.createElement('a')
    link.href = src
    link.download = `${label.toLowerCase().replace(/\s+/g, '-')}-${index + 1}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-foreground text-sm font-medium">{label}</p>
        {images.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {resolution} · {images.length} image{images.length > 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      <div
        data-testid={testId}
        className={cn(
          'border-border relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border',
          images.length > 0 ? 'bg-muted/10' : 'bg-muted/20',
        )}
      >
        {errorMessage && (
          <p className="text-destructive px-4">Error: {errorMessage}</p>
        )}
        {isPending && <Skeleton className="h-full w-full rounded-none" />}

        {!isPending && images.length === 0 && !errorMessage && (
          <div className="text-muted-foreground flex flex-col items-center gap-2">
            <ImageIcon className="h-12 w-12 opacity-30" />
            <p className="text-sm">{label} will appear here</p>
          </div>
        )}

        {!isPending && images.length === 1 && (
          <>
            <Image
              src={images[0]}
              alt={label}
              fill
              className="object-contain"
              unoptimized
            />
            <Button
              variant="secondary"
              size="icon"
              className="absolute right-2 bottom-2 h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100"
              onClick={() => downloadImage(images[0], 0)}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function formatTime(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}m ${secs}s`
}

function GenerationProgress({ taskStatus }: { taskStatus: TaskStatus }) {
  const progressPct = useMemo(() => {
    const {
      status,
      elapsed_time: elapsedTime,
      estimated_time: estimatedTime,
    } = taskStatus
    if (status === 'completed') return 100
    if (status === 'failed' || status === 'pending') return 0
    if (status === 'in_progress' && estimatedTime) {
      return Math.min(Math.round((elapsedTime / estimatedTime) * 100), 95)
    }
    return 0
  }, [taskStatus])

  const remaining =
    taskStatus.estimated_time && taskStatus.status === 'in_progress'
      ? Math.max(0, taskStatus.estimated_time - taskStatus.elapsed_time)
      : null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <div className="text-muted-foreground flex items-center gap-1.5">
          {taskStatus.status === 'in_progress' && (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
          {taskStatus.status === 'pending' && 'Starting...'}
          {taskStatus.status === 'in_progress' && 'Generating...'}
          {taskStatus.status === 'completed' && 'Complete'}
          {taskStatus.status === 'failed' && 'Failed'}
        </div>
        <span className="text-muted-foreground font-mono">
          {taskStatus.status === 'in_progress' && (
            <>
              {formatTime(taskStatus.elapsed_time)}
              {remaining != null && remaining > 0
                ? ` · ~${formatTime(remaining)} left`
                : ''}
            </>
          )}
          {taskStatus.status === 'completed' &&
            `Done in ${formatTime(taskStatus.elapsed_time)}`}
        </span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            taskStatus.status === 'failed'
              ? 'bg-destructive'
              : taskStatus.status === 'completed'
                ? 'bg-green-500'
                : 'bg-primary',
          )}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  )
}

export function ImageGenerationDemo({ service }: { service: Service }) {
  const [tab, setTab] = useState('generate')
  const [genPrompt, setGenPrompt] = useState(demoConfig.defaultInput)
  const [editPrompt, setEditPrompt] = useState('')
  const [sourceImage, setSourceImage] = useState<File | null>(null)
  const [sourcePreview, setSourcePreview] = useState<string | null>(null)

  const [negativePrompt, setNegativePrompt] = useState('')

  const isEditMode = tab === 'edit'
  const { values: imageGenValues, params } = useImageGenParams({
    showStrength: isEditMode,
  })

  const generateMutation = useGenerateImage()
  const editMutation = useEditImage()

  const model = service.currentModel ?? 'OpenVINO/stable-diffusion-v1-5-int8-ov'

  const handleGenerate = () => {
    generateMutation.mutate({
      model,
      prompt: genPrompt.trim(),
      size: imageGenValues.resolution,
      n: 1,
      num_inference_steps: imageGenValues.steps,
      guidance_scale: imageGenValues.cfgScale,
      ...(negativePrompt.trim() && {
        negative_prompt: negativePrompt.trim(),
      }),
    })
  }

  const handleEdit = () => {
    if (!sourceImage) return
    editMutation.mutate({
      model,
      prompt: editPrompt.trim(),
      image: sourceImage,
      size: imageGenValues.resolution,
      n: 1,
      num_inference_steps: imageGenValues.steps,
      guidance_scale: imageGenValues.cfgScale,
      strength: imageGenValues.strength,
      ...(negativePrompt.trim() && {
        negative_prompt: negativePrompt.trim(),
      }),
    })
  }

  const handleFileUpload = (file: File) => {
    setSourceImage(file)
    if (sourcePreview) URL.revokeObjectURL(sourcePreview)
    setSourcePreview(URL.createObjectURL(file))
  }

  const generatedImages = (generateMutation.data?.data ?? [])
    .filter((d) => d.b64_json)
    .map((d) => `data:image/png;base64,${d.b64_json}`)

  const editedImages = (editMutation.data?.data ?? [])
    .filter((d) => d.b64_json)
    .map((d) => `data:image/png;base64,${d.b64_json}`)

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <div className="min-w-0 flex-1 space-y-6">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="generate">Generate Image</TabsTrigger>
            <TabsTrigger value="edit">Edit Image</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="mt-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-3">
                <p className="text-foreground text-sm font-medium">
                  Text Prompt
                </p>
                <Textarea
                  data-testid="imggen-prompt"
                  value={genPrompt}
                  onChange={(e) => setGenPrompt(e.target.value)}
                  placeholder={demoConfig.inputPlaceholder}
                  rows={5}
                  className="bg-muted/30 resize-none"
                  disabled={generateMutation.isPending}
                />
                <Textarea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="Negative prompt (optional): blurry, low quality, watermark..."
                  rows={2}
                  className="bg-muted/30 resize-none"
                  disabled={generateMutation.isPending}
                />
                <Button
                  data-testid="imggen-generate-button"
                  onClick={handleGenerate}
                  disabled={generateMutation.isPending || !genPrompt.trim()}
                  className="bg-primary hover:bg-primary-light w-full gap-2 text-white"
                >
                  {generateMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Generate Image
                    </>
                  )}
                </Button>

                {generateMutation.taskStatus && generateMutation.isPending && (
                  <GenerationProgress
                    taskStatus={generateMutation.taskStatus}
                  />
                )}
              </div>

              <ImageOutput
                images={generatedImages}
                isPending={generateMutation.isPending}
                label="Generated Image"
                resolution={imageGenValues.resolution}
                data-testid="imggen-gallery"
                errorMessage={
                  generateMutation.error instanceof Error
                    ? generateMutation.error.message
                    : undefined
                }
              />
            </div>
          </TabsContent>

          <TabsContent value="edit" className="mt-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-3">
                <p className="text-foreground text-sm font-medium">
                  Source Image
                </p>

                <UploadButton
                  accept="image/*"
                  onFiles={(files) => handleFileUpload(files[0])}
                  disabled={editMutation.isPending}
                  className="w-full gap-2"
                >
                  <Upload className="h-4 w-4" />
                  {sourceImage ? 'Change Image' : 'Upload Image to Edit'}
                </UploadButton>

                {sourcePreview && (
                  <div className="bg-muted/30 flex justify-center rounded-lg border p-2">
                    <Image
                      src={sourcePreview}
                      alt="Source"
                      width={200}
                      height={200}
                      className="h-auto max-w-[200px] rounded"
                      unoptimized
                    />
                  </div>
                )}

                <p className="text-foreground text-sm font-medium">
                  Edit Prompt
                </p>
                <Textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  placeholder="Describe how you want to modify the image..."
                  rows={4}
                  className="bg-muted/30 resize-none"
                  disabled={editMutation.isPending}
                />
                <Textarea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="Negative prompt (optional): blurry, low quality, watermark..."
                  rows={2}
                  className="bg-muted/30 resize-none"
                  disabled={editMutation.isPending}
                />

                <Button
                  onClick={handleEdit}
                  disabled={
                    editMutation.isPending || !editPrompt.trim() || !sourceImage
                  }
                  className="bg-primary hover:bg-primary-light w-full gap-2 text-white"
                >
                  {editMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Editing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Edit Image
                    </>
                  )}
                </Button>
              </div>

              <ImageOutput
                images={editedImages}
                isPending={editMutation.isPending}
                label="Edited Image"
                resolution={imageGenValues.resolution}
                errorMessage={
                  editMutation.error instanceof Error
                    ? editMutation.error.message
                    : undefined
                }
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <div className="shrink-0 space-y-4 xl:w-72">
        <DemoParameterSidebar params={params} />
      </div>
    </div>
  )
}
