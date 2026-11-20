// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect } from 'react'
import { useLeaveGuard } from '@/components/common/leave-guard'
import {
  demoSessionKey,
  demoStateKey,
} from '@/services/common/demo/demo-session'
import {
  useSessionResource,
  useSetSessionBusy,
} from '@/services/common/demo/session-store'
import { useStoreSnapshot } from '@/services/common/demo/snapshot-store'
import { VideoJob, type VideoJobState } from '../lib/video-job'

/**
 * Kept per instance for the page visit; the instance is marked busy while a video is made. A video
 * left running on the worker is followed again on the next visit once the instance is `available`.
 */
export function useVideoJob(
  service: { id: string; instanceKey?: string },
  apiBase: string | undefined,
  available: boolean,
) {
  const setSessionBusy = useSetSessionBusy()
  const job = useSessionResource(
    demoStateKey(service, 'videogen:job'),
    () =>
      new VideoJob(
        (busy) => setSessionBusy(demoSessionKey(service), busy),
        `${demoSessionKey(service)}:videogen`,
      ),
    (owned) => owned.dispose(),
  )

  useEffect(() => {
    if (apiBase && available) job.resume(apiBase)
  }, [job, apiBase, available])

  return job
}

export function useVideoJobState(job: VideoJob): VideoJobState {
  return useStoreSnapshot(job)
}

/** An accepted video keeps going for the next visit; one still being sent is cancelled once named. */
export function useVideoJobLeaveGuard(active: boolean, sending: boolean) {
  useLeaveGuard(
    active,
    sending
      ? {
          title: 'Leave and cancel the video request?',
          description:
            'The request has not reached the worker yet: leaving this page cancels it.',
          confirmLabel: 'Leave and cancel',
          cancelLabel: 'Stay on page',
        }
      : {
          title: 'Leave while a video is generating?',
          description:
            'The video keeps generating on the worker. Come back to this page to see it: the worker keeps finished videos for an hour.',
          confirmLabel: 'Leave page',
          cancelLabel: 'Stay on page',
        },
  )
}
