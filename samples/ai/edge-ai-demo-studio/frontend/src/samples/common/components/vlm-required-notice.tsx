// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { useTextGenModelSupport } from '../hooks/use-text-gen-model'

/**
 * Warns while the running Text Generation model is not a vision language model; renders nothing
 * otherwise. `children` says what the images are for.
 */
export function VlmRequiredNotice({ children }: { children?: ReactNode }) {
  const { needsVlm } = useTextGenModelSupport()
  if (!needsVlm) return null
  return (
    <InlineNotice
      tone="warning"
      size="sm"
      icon={<AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />}
    >
      {children ??
        'The selected Text Generation model may not accept images. Choose a vision language model (VLM) under Services.'}
    </InlineNotice>
  )
}
