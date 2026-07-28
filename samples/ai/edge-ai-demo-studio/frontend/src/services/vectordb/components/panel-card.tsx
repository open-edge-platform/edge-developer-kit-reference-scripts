// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PanelCardProps {
  /** Icon shown (in the accent color) beside the title. */
  icon: LucideIcon
  /** Panel title. */
  title: ReactNode
  /** Optional element rendered at the right edge of the header (e.g. a refresh button). */
  action?: ReactNode
  /** Panel body. */
  children: ReactNode
  className?: string
  /** Extra classes for the body wrapper (defaults to a vertical stack). */
  bodyClassName?: string
}

/**
 * Shared card shell for the Vector Database workspace panels: a bordered,
 * rounded surface with an icon + title header and an optional header action.
 */
export function PanelCard({
  icon: Icon,
  title,
  action,
  children,
  className,
  bodyClassName,
}: PanelCardProps) {
  return (
    <div
      className={cn(
        'border-border bg-card overflow-hidden rounded-xl border shadow-sm',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-3.5">
        <Icon className="text-primary h-4 w-4 shrink-0" />
        <span className="text-foreground min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
        </span>
        {action}
      </div>
      <div className={cn('px-5 pb-5', bodyClassName)}>{children}</div>
    </div>
  )
}
