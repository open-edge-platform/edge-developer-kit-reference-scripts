// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Tooltip as TooltipPrimitive } from 'radix-ui'
import type * as React from 'react'
import { useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * Tooltip state a tap toggles too (Radix opens only on hover/focus, out of reach on touch screens).
 * Spread `triggerProps` on the trigger; `canOpen` vetoes opening.
 */
function useTapTooltip(canOpen: () => boolean = () => true): {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  onOpenChange: (open: boolean) => void
  triggerProps: {
    onPointerDown: () => void
    onClick: () => void
  }
} {
  const [open, setOpen] = useState(false)
  // Whether the tooltip showed when this press began: Radix closes it on
  // pointer down, and the click that follows must not open it again.
  const wasOpen = useRef(false)
  return {
    open,
    setOpen,
    onOpenChange: (next) => setOpen(next && canOpen()),
    triggerProps: {
      onPointerDown: () => {
        wasOpen.current = open
      },
      onClick: () => {
        const was = wasOpen.current
        wasOpen.current = false
        setOpen(!was && canOpen())
      },
    },
  }
}

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'animate-in bg-foreground text-background fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  useTapTooltip,
}
