// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle } from 'lucide-react'
import { useMemo } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import {
  useFeatureHandles,
  useFeaturePublish,
  useSingletonGroup,
} from '@/context/feature-collector'
import { useWakeWordTrigger } from './hooks/use-wake-word-trigger'

/**
 * Headless wake-word feature: publishes the Wake Word config group and calls the speech-to-text
 * `stt.startRecording` handle on a detection. A failed start shows in the group with a retry.
 */
export function WakeWordFeatureProvider() {
  const { getHandle } = useFeatureHandles()
  const { group, startError, retryStart } = useWakeWordTrigger({
    onWakeWord: () => getHandle('stt.startRecording')?.(),
  })
  const startErrorMessage = startError?.message

  // Memoized: `useFeaturePublish` publishes from an effect, so a new identity would loop.
  const shownGroup = useMemo(
    () =>
      startErrorMessage
        ? {
            ...group,
            children: (
              <InlineNotice
                tone="destructive"
                icon={<AlertCircle aria-hidden className="h-4 w-4 shrink-0" />}
                action={
                  <Button variant="outline" size="sm" onClick={retryStart}>
                    Retry
                  </Button>
                }
                data-testid="wake-word-start-error"
              >
                <span className="block font-medium">Not listening</span>
                {startErrorMessage}
              </InlineNotice>
            ),
          }
        : group,
    [group, startErrorMessage, retryStart],
  )
  const groups = useSingletonGroup(shownGroup)

  useFeaturePublish('wake-word-detection', { groups })

  return null
}
