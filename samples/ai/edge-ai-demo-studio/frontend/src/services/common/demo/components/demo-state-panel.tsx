// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { type LucideIcon, Terminal } from 'lucide-react'
import type { ReactNode } from 'react'
import { TONES, type Tone } from '@/components/common/tones'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type PanelTone = Extract<Tone, 'muted' | 'warning' | 'destructive' | 'success'>

/** A compact notice in place of the demo while it cannot run, with a way to its logs where it helps. */
export function DemoStatePanel({
  icon: Icon,
  iconClassName,
  tone = 'muted',
  title,
  description,
  children,
  testId,
}: {
  icon: LucideIcon
  iconClassName?: string
  tone?: PanelTone
  title: string
  description?: ReactNode
  children?: ReactNode
  testId?: string
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-3 rounded-xl border px-4 py-4 sm:flex-row sm:items-center sm:px-5',
        TONES[tone].surface,
      )}
      data-testid={testId}
    >
      <Icon
        aria-hidden="true"
        className={cn('h-5 w-5 shrink-0', TONES[tone].text, iconClassName)}
      />
      <div className="min-w-0 flex-1">
        <h3 className="text-foreground text-sm font-semibold">{title}</h3>
        {description && (
          <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 flex-wrap gap-2">{children}</div>
      )}
    </div>
  )
}

export function ViewLogsButton({ onClick }: { onClick?: () => void }) {
  if (!onClick) return null
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      <Terminal className="h-3.5 w-3.5" />
      View logs
    </Button>
  )
}
