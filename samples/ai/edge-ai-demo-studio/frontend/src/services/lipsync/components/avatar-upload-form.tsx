// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, Upload } from 'lucide-react'
import { useState } from 'react'
import { VideoFilePicker } from '@/components/common/video-file-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { JobProgress } from '@/services/common/jobs/job-progress'
import type { Service } from '@/services/types'
import { useAvatarGeneration } from '../hooks/use-avatar-generation'

/** Pick a video and a name, and make an avatar skin of it on the worker. */
export function AvatarUploadForm({
  service,
  sessionId,
}: {
  service: Service
  /** The live session, which shows the new skin once it is made. */
  sessionId: string | null
}) {
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null)
  const [skinName, setSkinName] = useState('')
  const avatar = useAvatarGeneration(service, {
    onUploaded: () => setSelectedVideo(null),
  })
  const isBusy = avatar.isUploading || avatar.isGenerating

  const handleVideoChange = (file: File | null) => {
    setSelectedVideo(file)
    if (file && !skinName) setSkinName(file.name.replace(/\.[^.]+$/, ''))
  }

  const handleGenerate = () => {
    if (!selectedVideo) return
    avatar.generate({
      videoFile: selectedVideo,
      sessionId: sessionId ?? undefined,
      skinName: skinName || undefined,
    })
  }

  return (
    <>
      <p className="text-muted-foreground text-xs">
        Upload a video to generate a new avatar skin.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label
            htmlFor="skin-name"
            className="text-muted-foreground text-xs font-medium"
          >
            Skin Name
          </Label>
          <Input
            id="skin-name"
            placeholder="Enter skin name"
            value={skinName}
            onChange={(e) => setSkinName(e.target.value)}
            disabled={isBusy}
            className="bg-muted/30"
          />
        </div>
      </div>

      <VideoFilePicker
        file={selectedVideo}
        onFileChange={handleVideoChange}
        disabled={isBusy}
        removeDisabled={avatar.isUploading}
        previewClassName="max-h-[220px]"
      />

      <Button
        onClick={handleGenerate}
        disabled={!selectedVideo || isBusy}
        className="gap-2"
      >
        {isBusy ? (
          <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : (
          <Upload aria-hidden="true" className="h-4 w-4" />
        )}
        {avatar.isUploading
          ? 'Uploading...'
          : avatar.isGenerating
            ? 'Generating Avatar...'
            : 'Generate Avatar'}
      </Button>

      {avatar.isGenerating && (
        <JobProgress
          label="Generating avatar"
          queued={avatar.isQueued}
          percent={(avatar.status?.progress ?? 0) * 100}
          detail={avatar.status?.message}
          cancelling={avatar.isCancelling}
          onCancel={avatar.cancel}
          className="max-w-none"
        />
      )}
    </>
  )
}
