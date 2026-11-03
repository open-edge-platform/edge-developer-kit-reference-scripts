// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { useGetService } from '@/context/service-status-context'
import { getServiceMetadata } from '@/lib/instances/service-metadata'

/** `metadata.frameGeneration`: on unless turned off. */
export function frameGenerationAllowed(
  lipsync: { metadata?: unknown } | undefined,
): boolean {
  return getServiceMetadata(lipsync ?? {}).frameGeneration !== false
}

/**
 * On when the instance allows it and the Frame Generation service runs, following both until the
 * user flips it.
 */
export function useFrameGeneration(
  lipsync: { metadata?: unknown } | undefined,
): [boolean, (on: boolean) => void] {
  const frameGenerationOnline =
    useGetService('frame-generation')?.status === 'online'
  const [choice, setChoice] = useState<boolean | null>(null)
  return [
    choice ?? (frameGenerationAllowed(lipsync) && frameGenerationOnline),
    setChoice,
  ]
}
