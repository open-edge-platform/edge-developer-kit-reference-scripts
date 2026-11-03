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
import {
  type ImageJob,
  ImageJobSession,
  type ImageJobState,
  type OutputSettings,
} from '../lib/image-job'

/**
 * Kept per instance for the page visit; the instance is marked busy while one is active. A job left
 * running on the worker is followed again on the next visit once the instance is `available`.
 */
export function useImageJobs(
  service: { id: string; instanceKey?: string },
  apiBase: string | undefined,
  available: boolean,
) {
  const setSessionBusy = useSetSessionBusy()
  const session = useSessionResource(
    demoStateKey(service, 'imggen:jobs'),
    () =>
      new ImageJobSession(
        (busy) => setSessionBusy(demoSessionKey(service), busy),
        demoSessionKey(service),
      ),
    (owned) => owned.dispose(),
  )

  // A job an earlier visit left: follow it again (no-op once one is shown).
  useEffect(() => {
    if (apiBase && available) session.resume(apiBase)
  }, [session, apiBase, available])

  return session
}

/**
 * An accepted job keeps running for the next visit; a request still `sending` is cancelled once
 * the worker answers, as nothing remembers its job yet.
 */
export function useImageJobLeaveGuard(active: boolean, sending: boolean) {
  useLeaveGuard(
    active,
    sending
      ? {
          title: 'Leave and cancel the image request?',
          description:
            'The request has not reached the worker yet: leaving this page cancels it.',
          confirmLabel: 'Leave and cancel',
          cancelLabel: 'Stay on page',
        }
      : {
          title: 'Leave while an image is generating?',
          description:
            'The image keeps generating on the worker. Come back to this page to see it: the worker keeps finished images for 30 minutes.',
          confirmLabel: 'Leave page',
          cancelLabel: 'Stay on page',
        },
  )
}

export function useImageJobState<TRequest extends OutputSettings>(
  job: ImageJob<TRequest>,
): ImageJobState {
  return useStoreSnapshot(job)
}
