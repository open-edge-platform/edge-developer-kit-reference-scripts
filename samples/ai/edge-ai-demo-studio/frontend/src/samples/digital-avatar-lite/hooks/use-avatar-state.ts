// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation } from '@tanstack/react-query'
import { postJson } from '@/lib/browser/fetch-json'
import type { VideoState } from '../lib/types'

/** Switches the avatar's video loop (idle, talking, waving) on the MJPEG stream. */
export function useAvatarState() {
  const { mutate } = useMutation({
    mutationFn: (state: VideoState) =>
      postJson('/api/digital-avatar-lite/stream', { state }),
  })
  return mutate
}
