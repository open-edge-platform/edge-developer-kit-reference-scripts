// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'
import { TONES, type Tone } from '@/components/common/tones'
import { cn } from '@/lib/utils'

export type InlineNoticeTone = Extract<
  Tone,
  'info' | 'warning' | 'destructive' | 'success'
>

/** Both sizes are 12px: notices carry errors and warnings, too important for 11px. */
export type InlineNoticeSize = 'xs' | 'sm'

const SIZE_CLASSES: Record<InlineNoticeSize, string> = {
  xs: 'text-xs',
  sm: 'text-xs',
}

export interface InlineNoticeProps {
  tone: InlineNoticeTone
  icon?: ReactNode
  children: ReactNode
  className?: string
  size?: InlineNoticeSize
  /** Overrides the live-region role (destructive defaults to `alert`); `null` for static content. */
  role?: 'alert' | 'status' | 'note' | null
  /** A control at the end of the notice, e.g. a Retry button. */
  action?: ReactNode
  'data-testid'?: string
}

/** Small bordered inline callout on the tone tokens, for inline errors and warnings. */
export function InlineNotice({
  tone,
  icon,
  children,
  className,
  size = 'xs',
  role,
  action,
  'data-testid': testId,
}: InlineNoticeProps) {
  const { surface, strongText } = TONES[tone]
  const liveRole =
    role === undefined ? (tone === 'destructive' ? 'alert' : undefined) : role
  return (
    <div
      role={liveRole ?? undefined}
      data-testid={testId}
      className={cn(
        'rounded-md border p-2.5',
        surface,
        (icon || action) && 'flex items-center gap-2',
        className,
      )}
    >
      {icon}
      <p
        className={cn(
          SIZE_CLASSES[size],
          strongText,
          action && 'min-w-0 flex-1',
        )}
      >
        {children}
      </p>
      {action}
    </div>
  )
}
