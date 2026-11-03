// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, useState } from 'react'
import { copyText } from '@/lib/browser/clipboard'

export interface UseCopyToClipboardResult {
  copied: boolean
  copy: (text: string) => Promise<boolean>
}

/** Copies text to the clipboard and flashes `copied` for `resetMs`. */
export function useCopyToClipboard(resetMs = 2000): UseCopyToClipboardResult {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPendingReset = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  const copy = async (text: string) => {
    try {
      await copyText(text)
      setCopied(true)
      clearPendingReset()
      timeoutRef.current = setTimeout(() => setCopied(false), resetMs)
      return true
    } catch {
      return false
    }
  }

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    },
    [],
  )

  return { copied, copy }
}
