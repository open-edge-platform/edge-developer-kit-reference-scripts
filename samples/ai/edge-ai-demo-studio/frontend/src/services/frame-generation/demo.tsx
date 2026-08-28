// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Download, Film, Loader2, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  type InterpolationMode,
  useInterpolateVideo,
  useResultVideo,
  useVideoTaskStatus,
} from './hooks'

const MULTIPLIER_OPTIONS = ['2', '3', '4']

const MODE_OPTIONS: { value: InterpolationMode; label: string }[] = [
  { value: 'fps', label: 'Higher FPS (same duration)' },
  { value: 'slowmo', label: 'Slow motion (same FPS, longer)' },
]

export function FrameGenerationDemo() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Video srcs are assigned imperatively via refs (not a src prop) so static
  // analysis can verify no attacker-controlled URL reaches the DOM.
  const sourceVideoRef = useRef<HTMLVideoElement>(null)
  const resultVideoRef = useRef<HTMLVideoElement>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [multiplier, setMultiplier] = useState('2')
  const [mode, setMode] = useState<InterpolationMode>('fps')
  const [taskId, setTaskId] = useState<string | null>(null)

  const { mutate: interpolate, isPending: isUploading } = useInterpolateVideo()
  const {
    data: task,
    error: taskStatusError,
    isError: isTaskStatusError,
  } = useVideoTaskStatus(taskId)

  const isQueued = !!taskId && task?.status === 'queued'
  const isProcessing =
    !!taskId &&
    !isTaskStatusError &&
    (!task || isQueued || task.status === 'running')
  const isFinished = !!taskId && task?.status === 'finished'
  const isError =
    !!taskId &&
    (isTaskStatusError ||
      task?.status === 'error' ||
      task?.status === 'not_found')
  const errorDetail = isTaskStatusError
    ? taskStatusError instanceof Error
      ? taskStatusError.message
      : 'Unable to check interpolation status'
    : task?.status === 'not_found'
      ? 'The interpolation task was not found'
      : (task?.detail ?? 'unknown error')
  const progress = Math.round((task?.progress ?? 0) * 100)

  const {
    data: resultBlob,
    isLoading: isResultLoading,
    isError: isResultError,
  } = useResultVideo(taskId, isFinished)

  useEffect(() => {
    const video = sourceVideoRef.current
    if (!video || !videoFile) return
    const url = URL.createObjectURL(videoFile)
    video.src = url
    return () => {
      video.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [videoFile])

  useEffect(() => {
    const video = resultVideoRef.current
    if (!video || !resultBlob) return
    const url = URL.createObjectURL(resultBlob)
    video.src = url
    return () => {
      video.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [resultBlob])

  const handleFileChange = useCallback((file: File | null) => {
    setVideoFile(file)
    setTaskId(null)
  }, [])

  const handleSubmit = useCallback(() => {
    if (!videoFile) return
    setTaskId(null)
    interpolate(
      { videoFile, multiplier: Number(multiplier), mode },
      {
        onSuccess: ({ taskId: id }) => setTaskId(id),
        onError: (e) =>
          toast.error(
            e instanceof Error ? e.message : 'Failed to start interpolation',
          ),
      },
    )
  }, [videoFile, multiplier, mode, interpolate])

  const handleDownload = useCallback(() => {
    if (!taskId || !resultBlob) return
    const url = URL.createObjectURL(resultBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `interpolated_${taskId}.mp4`
    link.click()
    URL.revokeObjectURL(url)
  }, [taskId, resultBlob])

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        Interpolate a video with RIFE: generate intermediate frames between
        every pair of consecutive frames, either to raise the frame rate or to
        create a smooth slow-motion version. Jobs are processed one at a time.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border-border space-y-4 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Source video
          </p>

          {videoFile ? (
            <div className="space-y-2">
              <video
                ref={sourceVideoRef}
                controls
                muted
                playsInline
                className="bg-muted/50 mx-auto max-h-64 w-auto max-w-full rounded-md object-contain"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground truncate text-xs">
                  {videoFile.name}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    handleFileChange(null)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="border-border bg-muted/10 hover:bg-muted/20 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors"
            >
              <Upload className="text-muted-foreground h-6 w-6" />
              <span className="text-foreground text-sm font-medium">
                Choose a video
              </span>
              <span className="text-muted-foreground text-xs">
                MP4, WebM or other common formats
              </span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label
                htmlFor="fg-mode-select"
                className="text-muted-foreground text-xs"
              >
                Mode
              </Label>
              <Select
                value={mode}
                onValueChange={(v) => setMode(v as InterpolationMode)}
              >
                <SelectTrigger id="fg-mode-select" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OPTIONS.map((m) => (
                    <SelectItem
                      key={m.value}
                      value={m.value}
                      className="text-xs"
                    >
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="fg-multiplier-select"
                className="text-muted-foreground text-xs"
              >
                {mode === 'fps' ? 'FPS multiplier' : 'Slow-down factor'}
              </Label>
              <Select value={multiplier} onValueChange={setMultiplier}>
                <SelectTrigger
                  id="fg-multiplier-select"
                  className="w-full text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MULTIPLIER_OPTIONS.map((m) => (
                    <SelectItem key={m} value={m} className="text-xs">
                      {m}x
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            className="w-full"
            disabled={!videoFile || isUploading || isProcessing}
            onClick={handleSubmit}
          >
            {isUploading || isProcessing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Film className="mr-1.5 h-4 w-4" />
            )}
            {isUploading
              ? 'Uploading...'
              : isQueued
                ? 'Queued...'
                : isProcessing
                  ? 'Interpolating...'
                  : 'Interpolate'}
          </Button>
        </div>

        <div className="border-border space-y-4 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Result
          </p>

          {isQueued && (
            <p className="text-muted-foreground py-8 text-center text-xs">
              Waiting in queue
              {task?.position ? ` (position ${task.position})` : ''}...
            </p>
          )}

          {isProcessing && !isQueued && (
            <div className="space-y-2 py-8">
              <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-muted-foreground text-center text-xs">
                Generating frames... {progress}%
              </p>
            </div>
          )}

          {isError && (
            <p className="text-destructive py-8 text-center text-xs">
              Interpolation failed: {errorDetail}
            </p>
          )}

          {isFinished && taskId && isResultLoading && (
            <p className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-center text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading result...
            </p>
          )}

          {isFinished && taskId && isResultError && (
            <p className="text-destructive py-8 text-center text-xs">
              Failed to load the interpolated video.
            </p>
          )}

          {isFinished && taskId && resultBlob && (
            <div className="space-y-2">
              <video
                ref={resultVideoRef}
                controls
                muted
                playsInline
                className="bg-muted/50 mx-auto max-h-64 w-auto max-w-full rounded-md object-contain"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                  {task?.mode === 'slowmo'
                    ? `${task?.multiplier}x slower · ${task?.frames} frames at ${task?.output_fps?.toFixed(1)} FPS`
                    : `${task?.input_fps?.toFixed(1)} FPS → ${task?.output_fps?.toFixed(1)} FPS (${task?.frames} frames)`}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!resultBlob}
                  onClick={handleDownload}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Download
                </Button>
              </div>
            </div>
          )}

          {!taskId && (
            <p className="text-muted-foreground py-8 text-center text-xs">
              The interpolated video will appear here.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
