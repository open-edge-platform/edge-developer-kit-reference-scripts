// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CANCELLED } from '@/lib/browser/sse'
import { toastError } from '@/lib/browser/toast-error'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { useJobRun } from '@/services/common/jobs/use-job-run'
import type { Service } from '@/services/types'
import { type AvatarUpload, avatarJob, avatarsKey } from './index'

/**
 * One skin job at a time, kept per instance for the page visit. Leaving the page stops following
 * the job, not the job: an upload in flight completes and the skin is listed later.
 */
export function useAvatarGeneration(
  service: Service,
  { onUploaded }: { onUploaded?: () => void } = {},
) {
  const queryClient = useQueryClient()
  const { apiBase } = service
  const definition = avatarJob(apiBase)
  const job = useJobRun(
    {
      ...definition,
      // Not handed the run's signal, which leaving the page aborts, so the upload completes and
      // the job is still created.
      submit: async (upload: AvatarUpload) => {
        const taskId = await definition.submit(
          upload,
          new AbortController().signal,
        )
        toast.success(
          `Video file "${upload.videoFile.name}" is being processed for lipsync`,
        )
        onUploaded?.()
        return taskId
      },
    },
    {
      sessionKey: demoStateKey(service, 'lipsync:avatar-job'),
      cancelOnDispose: false,
    },
  )

  const refreshSkins = () =>
    queryClient.invalidateQueries({ queryKey: avatarsKey(apiBase) })

  const generate = async (upload: AvatarUpload) => {
    const settled = await job.start(upload)
    if (settled.phase === 'done') {
      toast.success('Avatar skin generated successfully')
      refreshSkins()
    } else if (settled.status?.status === CANCELLED) {
      // Cancelled on the worker; a job only left behind keeps running and is not reported.
      toast('Avatar generation cancelled')
      // A skin listed while its MuseTalk crops were prepared is gone now.
      refreshSkins()
    } else if (settled.phase === 'failed') {
      if (settled.jobId === null) {
        toastError('Failed to upload the video')(settled.error)
      } else {
        const detail = settled.error?.message
        toast.error(
          detail
            ? `Avatar generation failed: ${detail}`
            : 'Avatar generation failed',
        )
      }
    }
  }

  return {
    generate,
    cancel: job.cancel,
    isUploading: job.phase === 'submitting',
    /** The worker is making the skin (queued or running). */
    isGenerating: job.phase === 'queued' || job.phase === 'running',
    isQueued: job.phase === 'queued',
    isCancelling: job.cancelling,
    /** The job's latest status: `progress` (0–1) and a `message`. */
    status: job.status,
  }
}
