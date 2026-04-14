// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader2, Upload, Video, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAvatarList, useSkinUpload } from '../hooks'

const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
]

export interface AvatarsTabProps {
  sessionId: string | null
}

export function AvatarsTab({ sessionId }: AvatarsTabProps) {
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null)
  const [skinName, setSkinName] = useState('')
  const videoInputRef = useRef<HTMLInputElement>(null)

  const skinUpload = useSkinUpload()
  const avatarList = useAvatarList(sessionId !== null)
  const isConnected = sessionId !== null

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!SUPPORTED_VIDEO_TYPES.includes(file.type)) {
      toast.error(`Unsupported file type: ${file.type}`)
      e.target.value = ''
      return
    }
    setSelectedVideo(file)
  }

  const clearSelectedVideo = () => {
    setSelectedVideo(null)
    if (videoInputRef.current) videoInputRef.current.value = ''
  }

  const handleProcessVideo = () => {
    if (!selectedVideo || !sessionId) return
    skinUpload.mutate(
      {
        videoFile: selectedVideo,
        sessionId,
        skinName: skinName || undefined,
      },
      {
        onSuccess: () => {
          toast.success(
            `Video file "${selectedVideo.name}" is being processed for lipsync`,
          )
          clearSelectedVideo()
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
            disabled={!isConnected || skinUpload.isPending}
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
          disabled={!isConnected || skinUpload.isPending}
          className="hidden"
        />
        {selectedVideo ? (
          <div className="border-primary/30 bg-primary/5 flex items-center justify-between rounded-lg border p-3">
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
        ) : (
          <button
            type="button"
            className="border-border hover:border-primary/40 hover:bg-muted/30 flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => videoInputRef.current?.click()}
            disabled={!isConnected || skinUpload.isPending}
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
        disabled={!selectedVideo || !isConnected || skinUpload.isPending}
        className="bg-primary hover:bg-primary-light gap-2 text-white"
      >
        {skinUpload.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {skinUpload.isPending ? 'Uploading & Generating...' : 'Generate Avatar'}
      </Button>

      {avatarList.data && avatarList.data.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium">
            Available Skins ({avatarList.data.length})
          </p>
          <div className="max-h-[160px] space-y-1.5 overflow-auto">
            {avatarList.data.map((skin) => (
              <div
                key={skin.skin_id}
                className="border-border bg-muted/20 flex items-center gap-2 rounded-lg border p-2.5 text-sm"
              >
                <Badge variant="secondary" className="font-mono text-xs">
                  {skin.skin_id}
                </Badge>
                {skin.skin_name && (
                  <span className="text-muted-foreground truncate">
                    {skin.skin_name}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
