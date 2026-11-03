// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'

interface SettingsRequiredNoticeProps {
  /** Message body; receives the "Settings" link to embed inline. */
  children: (settingsLink: ReactNode) => ReactNode
  onOpenSettings: () => void
  className?: string
}

/** "Configure Geti in Settings" notice. */
export function SettingsRequiredNotice({
  children,
  onOpenSettings,
  className,
}: SettingsRequiredNoticeProps) {
  const settingsLink = (
    <button
      type="button"
      className="font-medium underline underline-offset-2"
      onClick={onOpenSettings}
    >
      Settings
    </button>
  )

  return (
    <InlineNotice
      tone="warning"
      size="sm"
      role="note"
      icon={
        <AlertCircle className="text-warning h-4 w-4 shrink-0" aria-hidden />
      }
      className={className}
    >
      {children(settingsLink)}
    </InlineNotice>
  )
}
