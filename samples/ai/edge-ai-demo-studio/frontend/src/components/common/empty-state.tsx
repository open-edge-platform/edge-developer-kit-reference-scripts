// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Tone } from '@/components/common/tones'
import { cn } from '@/lib/utils'

export type EmptyStateTone = Extract<
  Tone,
  'muted' | 'primary' | 'warning' | 'destructive'
>

const TONE_CLASSES: Record<EmptyStateTone, { circle: string; icon: string }> = {
  muted: { circle: 'bg-muted/40', icon: 'text-muted-foreground' },
  primary: {
    circle: 'bg-primary/10 shadow-primary/5 shadow-sm',
    icon: 'text-primary',
  },
  warning: { circle: 'bg-warning/10', icon: 'text-warning' },
  destructive: {
    circle: 'bg-destructive/10 shadow-destructive/5 shadow-sm',
    icon: 'text-destructive',
  },
}

export interface EmptyStateProps {
  icon: LucideIcon
  /** Heading. Omit for a bare one-line notice. */
  title?: ReactNode
  description?: ReactNode
  tone?: EmptyStateTone
  /** `sm` drops the dashed frame for a compact inline notice. */
  size?: 'sm' | 'md'
  /** Actions rendered under the text (buttons, links). */
  children?: ReactNode
  /** Extra classes for the icon itself, e.g. `animate-spin`. */
  iconClassName?: string
  className?: string
}

/** The dashed placeholder panel for any surface with nothing to show. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  tone = 'muted',
  size = 'md',
  children,
  iconClassName,
  className,
}: EmptyStateProps) {
  const isCompact = size === 'sm'
  const toneClasses = TONE_CLASSES[tone]

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        isCompact
          ? 'py-20'
          : 'border-border bg-muted/10 rounded-xl border-2 border-dashed px-6 py-16',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-full',
          isCompact ? 'mb-3 h-12 w-12' : 'mb-4 h-16 w-16',
          toneClasses.circle,
        )}
      >
        <Icon
          className={cn(
            isCompact ? 'h-6 w-6' : 'h-8 w-8',
            toneClasses.icon,
            iconClassName,
          )}
        />
      </div>

      {title && (
        <h3 className="text-foreground text-lg font-semibold">{title}</h3>
      )}

      {description && (
        <p
          className={cn(
            'text-muted-foreground text-sm',
            title && 'mt-2 max-w-md',
          )}
        >
          {description}
        </p>
      )}

      {children}
    </div>
  )
}
