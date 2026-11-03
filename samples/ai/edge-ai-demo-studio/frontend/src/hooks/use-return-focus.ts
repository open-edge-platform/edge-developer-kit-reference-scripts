// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { type RefObject, useLayoutEffect, useRef } from 'react'

/**
 * `onCloseAutoFocus` handler for a controlled Radix `Dialog`/`Sheet` opened without its `*Trigger`
 * (Radix only refocuses the trigger): refocuses the opener if still on the page, else `fallback`.
 */
export function useReturnFocus(
  open: boolean,
  fallback?: RefObject<HTMLElement | null>,
): (event: Event) => void {
  const openerRef = useRef<HTMLElement | null>(null)
  // Layout effect: it runs before Radix's FocusScope moves focus in, so the opener is still active.
  useLayoutEffect(() => {
    if (!open) return
    const active = document.activeElement
    openerRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null
  }, [open])
  return (event: Event) => {
    const target = [openerRef.current, fallback?.current].find(
      (el) => el?.isConnected,
    )
    if (target) {
      event.preventDefault()
      target.focus()
    }
  }
}
