// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { Service } from '@/services/types'
import { AvatarUploadForm } from './avatar-upload-form'
import { SkinGrid } from './skin-grid'

export interface AvatarsTabProps {
  service: Service
  sessionId: string | null
}

/** The Avatars tab: make a new skin from a video, and manage the skins. */
export function AvatarsTab({ service, sessionId }: AvatarsTabProps) {
  return (
    <>
      <AvatarUploadForm service={service} sessionId={sessionId} />
      <SkinGrid apiBase={service.apiBase} />
    </>
  )
}
