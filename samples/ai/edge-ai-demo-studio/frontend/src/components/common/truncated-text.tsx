// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useTapTooltip,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** The control that holds focus for text that is not a tab stop itself. */
const HOST_SELECTOR =
  'a[href], button, [role="menuitem"], [role="menuitemradio"], [role="option"], [role="link"], [tabindex]'

/**
 * One line cut with an ellipsis; the full value shows on hover, focus (a tab stop while cut) or tap.
 * Inside a link, button or menu item pass `focusable={false}` (no nested tab stop): it then follows
 * the control's hover and focus, and the control should carry the full value as its name.
 */
export function TruncatedText({
  text,
  className,
  focusable = true,
  'data-testid': testId,
}: {
  text: string
  /** Width limits, font (e.g. `font-mono`) and color. */
  className?: string
  /** `false` inside an interactive element (link, button, menu item). */
  focusable?: boolean
  'data-testid'?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)

  const isCut = () => {
    const el = ref.current
    return el !== null && el.scrollWidth > el.clientWidth
  }
  const { open, setOpen, onOpenChange, triggerProps } = useTapTooltip(isCut)

  // Only cut text is a tab stop. Text that fits stays script-focusable (-1) so a focus before the
  // first measurement still works. Remeasured on resize, and for new text via a fresh observer.
  const [cut, setCut] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !focusable) return
    const observer = new ResizeObserver(() =>
      setCut(el.scrollWidth > el.clientWidth),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [focusable, text])

  // Not a tab stop: show the value while the surrounding control is
  // hovered or focused, the way it would show for the text itself.
  useEffect(() => {
    const el = ref.current
    const host = focusable ? null : el?.parentElement?.closest(HOST_SELECTOR)
    if (!el || !(host instanceof HTMLElement)) return
    const show = (event: Event) => {
      if (event instanceof PointerEvent && event.pointerType === 'touch') return
      setOpen(el.scrollWidth > el.clientWidth)
    }
    const hide = () => setOpen(false)
    host.addEventListener('focusin', show)
    host.addEventListener('focusout', hide)
    host.addEventListener('pointerenter', show)
    host.addEventListener('pointerleave', hide)
    return () => {
      host.removeEventListener('focusin', show)
      host.removeEventListener('focusout', hide)
      host.removeEventListener('pointerenter', show)
      host.removeEventListener('pointerleave', hide)
    }
  }, [focusable, setOpen])

  return (
    <Tooltip open={open} onOpenChange={onOpenChange}>
      <TooltipTrigger asChild>
        <span
          ref={ref}
          tabIndex={focusable ? (cut ? 0 : -1) : undefined}
          data-testid={testId}
          {...(focusable ? triggerProps : {})}
          className={cn(
            'block min-w-0 truncate',
            focusable &&
              'focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-[3px]',
            className,
          )}
        >
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[min(90vw,32rem)] break-all">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}
