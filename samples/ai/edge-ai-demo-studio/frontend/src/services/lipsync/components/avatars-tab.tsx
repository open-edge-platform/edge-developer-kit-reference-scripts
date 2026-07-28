// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ImageOff,
  Loader2,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  type AvatarSkin,
  useAvatarList,
  useAvatarTaskStatus,
  useDeleteSkin,
  useSetDefaultSkin,
  useSkinUpload,
} from '../hooks'

const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
]

export interface AvatarsTabProps {
  sessionId: string | null
}

function AvatarPreview({
  skinId,
  displayName,
  handlePreviewError,
}: {
  skinId: string
  displayName: string
  handlePreviewError: (skinId: string) => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    img.src = `/api/lipsync/v1/avatar/${encodeURIComponent(skinId)}/preview`
    return () => {
      img.removeAttribute('src')
    }
  }, [skinId])

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      alt={`Preview of skin ${displayName}`}
      loading="lazy"
      className="h-full w-full object-cover"
      onError={() => handlePreviewError(skinId)}
    />
  )
}

function VideoPreview({ file }: { file: File }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const url = URL.createObjectURL(file)
    video.src = url
    return () => {
      video.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [file])

  return (
    <video
      ref={videoRef}
      controls
      muted
      playsInline
      className="bg-muted/50 mx-auto max-h-[220px] w-auto max-w-full rounded-md object-contain"
    />
  )
}

export function AvatarsTab({ sessionId }: AvatarsTabProps) {
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null)
  const [skinName, setSkinName] = useState('')
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [skinToDelete, setSkinToDelete] = useState<AvatarSkin | null>(null)
  const [brokenPreviews, setBrokenPreviews] = useState<ReadonlySet<string>>(
    new Set(),
  )
  const videoInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  const skinUpload = useSkinUpload()
  const avatarList = useAvatarList(true)
  const setDefaultSkin = useSetDefaultSkin()
  const deleteSkin = useDeleteSkin()
  const taskStatus = useAvatarTaskStatus(activeTaskId)

  const skins = avatarList.data?.items ?? []
  const defaultSkinId = avatarList.data?.default_skin ?? null

  const status = taskStatus.data?.status
  const isTerminal =
    status !== undefined && ['finished', 'error', 'not_found'].includes(status)
  const isGenerating = activeTaskId !== null && !isTerminal

  const handledTaskRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeTaskId || !isTerminal || handledTaskRef.current === activeTaskId)
      return
    handledTaskRef.current = activeTaskId
    if (status === 'finished') {
      toast.success('Avatar skin generated successfully')
      queryClient.invalidateQueries({ queryKey: ['lipsync', 'avatars'] })
    } else {
      toast.error(
        taskStatus.data?.detail
          ? `Avatar generation failed: ${taskStatus.data.detail}`
          : 'Avatar generation failed',
      )
    }
  }, [activeTaskId, isTerminal, status, taskStatus.data, queryClient])

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!SUPPORTED_VIDEO_TYPES.includes(file.type)) {
      toast.error(`Unsupported file type: ${file.type}`)
      e.target.value = ''
      return
    }
    setSelectedVideo(file)
    // Default the skin name to the uploaded file's name (still editable).
    if (!skinName) {
      setSkinName(file.name.replace(/\.[^.]+$/, ''))
    }
  }

  const handlePreviewError = (skinId: string) => {
    setBrokenPreviews((prev) => {
      if (prev.has(skinId)) return prev
      return new Set(prev).add(skinId)
    })
  }

  const handleSelectSkin = (skinId: string) => {
    setDefaultSkin.mutate(skinId, {
      onSuccess: (data) =>
        toast.success(
          data.reloaded_sessions?.length
            ? 'Avatar skin updated and applied to the live stream.'
            : 'Avatar skin updated.',
        ),
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : 'Failed to set skin'),
    })
  }

  const handleDeleteSkin = () => {
    if (!skinToDelete) return
    const { skin_id: skinId } = skinToDelete
    setSkinToDelete(null)
    deleteSkin.mutate(skinId, {
      onSuccess: () => toast.success('Skin deleted'),
      onError: (e) =>
        toast.error(
          e instanceof Error && e.message ? e.message : 'Failed to delete skin',
        ),
    })
  }

  const clearSelectedVideo = () => {
    setSelectedVideo(null)
    if (videoInputRef.current) videoInputRef.current.value = ''
  }

  const handleProcessVideo = () => {
    if (!selectedVideo) return
    skinUpload.mutate(
      {
        videoFile: selectedVideo,
        sessionId: sessionId ?? undefined,
        skinName: skinName || undefined,
      },
      {
        onSuccess: (data: { taskId?: string }) => {
          toast.success(
            `Video file "${selectedVideo.name}" is being processed for lipsync`,
          )
          clearSelectedVideo()
          if (data.taskId) setActiveTaskId(data.taskId)
        },
        onError: () =>
          toast.error('Failed to process video file. Please try again.'),
      },
    )
  }

  return (
    <>
      <p className="text-muted-foreground text-xs">
        Upload a video to generate a new avatar skin.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label
            htmlFor="skin-name"
            className="text-muted-foreground text-xs font-medium"
          >
            Skin Name
          </label>
          <Input
            id="skin-name"
            placeholder="Enter skin name"
            value={skinName}
            onChange={(e) => setSkinName(e.target.value)}
            disabled={skinUpload.isPending || isGenerating}
            className="bg-muted/30"
          />
        </div>
      </div>

      <div>
        <input
          ref={videoInputRef}
          type="file"
          accept={SUPPORTED_VIDEO_TYPES.join(',')}
          onChange={handleVideoSelect}
          disabled={skinUpload.isPending || isGenerating}
          className="hidden"
        />
        {selectedVideo ? (
          <div className="border-primary/30 bg-primary/5 space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 overflow-hidden">
                <Video className="text-primary h-4 w-4 shrink-0" />
                <span className="truncate text-sm font-medium">
                  {selectedVideo.name}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  ({(selectedVideo.size / (1024 * 1024)).toFixed(1)} MB)
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={clearSelectedVideo}
                disabled={skinUpload.isPending}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <VideoPreview file={selectedVideo} />
          </div>
        ) : (
          <button
            type="button"
            className="border-border hover:border-primary/40 hover:bg-muted/30 flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => videoInputRef.current?.click()}
            disabled={skinUpload.isPending || isGenerating}
          >
            <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
              <Upload className="text-muted-foreground h-5 w-5" />
            </div>
            <div className="text-center">
              <p className="text-foreground text-sm font-medium">
                Click to upload video
              </p>
              <p className="text-muted-foreground text-xs">
                MP4, MOV, MKV, or WEBM
              </p>
            </div>
          </button>
        )}
      </div>

      <Button
        onClick={handleProcessVideo}
        disabled={!selectedVideo || skinUpload.isPending || isGenerating}
        className="bg-primary hover:bg-primary-light gap-2 text-white"
      >
        {skinUpload.isPending || isGenerating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {skinUpload.isPending
          ? 'Uploading...'
          : isGenerating
            ? 'Generating Avatar...'
            : 'Generate Avatar'}
      </Button>

      {skins.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium">
            Available Skins ({skins.length})
          </p>
          <div className="max-h-[320px] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {skins.map((skin) => {
                const isActive = skin.skin_id === defaultSkinId
                const displayName = skin.skin_name || skin.skin_id
                const previewBroken = brokenPreviews.has(skin.skin_id)
                const mutationPending =
                  setDefaultSkin.isPending || deleteSkin.isPending
                return (
                  <div
                    key={skin.skin_id}
                    className={cn(
                      'bg-muted/20 overflow-hidden rounded-lg border transition-colors',
                      isActive
                        ? 'border-primary ring-primary/40 ring-1'
                        : 'border-border hover:border-primary/40',
                    )}
                  >
                    <div className="bg-muted relative aspect-[3/4]">
                      {previewBroken ? (
                        <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-1">
                          <ImageOff className="h-6 w-6" />
                          <span className="text-[10px]">No preview</span>
                        </div>
                      ) : (
                        <AvatarPreview
                          skinId={skin.skin_id}
                          displayName={displayName}
                          handlePreviewError={handlePreviewError}
                        />
                      )}
                      {isActive && (
                        <Badge className="absolute top-1.5 left-1.5 gap-1 text-xs shadow-sm">
                          <Check className="h-3 w-3" />
                          Active
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 p-1.5">
                      <span
                        className="text-foreground truncate text-xs font-medium"
                        title={displayName}
                      >
                        {displayName}
                      </span>
                      {!isActive && (
                        <div className="ml-auto flex shrink-0 items-center gap-0.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => handleSelectSkin(skin.skin_id)}
                            disabled={mutationPending}
                          >
                            Use
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive h-6 w-6"
                            aria-label={`Delete skin ${displayName}`}
                            onClick={() => setSkinToDelete(skin)}
                            disabled={mutationPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <AlertDialog
        open={skinToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setSkinToDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete skin?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the skin{' '}
              <span className="text-foreground font-medium">
                {skinToDelete
                  ? skinToDelete.skin_name || skinToDelete.skin_id
                  : ''}
              </span>
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={handleDeleteSkin}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
