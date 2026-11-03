// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Info } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useTapTooltip,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface InfoTipProps {
  tooltip?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  className?: string
  contentClassName?: string
  /** Accessible name, e.g. `About Temperature`; defaults to "More information". */
  ariaLabel?: string
  /** `sm` shrinks the hit target/icon for use inside dense stat rows. */
  size?: 'default' | 'sm'
  /** Trigger element: `button` (default) or `span` for nesting inside another interactive element. */
  as?: 'button' | 'span'
}

const BOX_SIZE = { default: 'h-5 w-5', sm: 'h-4 w-4' } as const
const ICON_SIZE = { default: 'h-3.5 w-3.5', sm: 'h-3 w-3' } as const
/** Grows the button's touch target to 32px without moving anything beside it. */
const HIT_AREA = {
  default: "relative after:absolute after:-inset-1.5 after:content-['']",
  sm: "relative after:absolute after:-inset-2 after:content-['']",
} as const

/**
 * Info-icon tooltip trigger. Renders nothing when `tooltip` is empty. The
 * button form also opens on tap, where hover never happens.
 */
export function InfoTip({
  tooltip,
  side,
  sideOffset = 6,
  className,
  contentClassName,
  ariaLabel,
  size = 'default',
  as = 'button',
}: InfoTipProps) {
  const { open, onOpenChange, triggerProps } = useTapTooltip()
  if (!tooltip) return null
  const triggerClassName = cn(
    'hover:bg-muted/20 flex items-center justify-center rounded',
    BOX_SIZE[size],
    className,
  )
  const label = ariaLabel ?? 'More information'
  const icon = (
    <Info
      aria-hidden="true"
      className={cn('text-muted-foreground', ICON_SIZE[size])}
    />
  )
  return (
    <Tooltip open={open} onOpenChange={onOpenChange}>
      <TooltipTrigger asChild>
        {as === 'span' ? (
          <span aria-label={label} className={triggerClassName}>
            {icon}
          </span>
        ) : (
          <button
            type="button"
            aria-label={label}
            className={cn(HIT_AREA[size], triggerClassName)}
            {...triggerProps}
          >
            {icon}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={sideOffset}
        className={contentClassName}
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
