// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { type ReactNode, useEffect } from 'react'
import { useSettings } from '@/context/settings-context'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings()

  useEffect(() => {
    const root = document.documentElement

    const applyTheme = (theme: 'light' | 'dark') => {
      root.classList.remove('light', 'dark')
      root.classList.add(theme)
    }

    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => applyTheme(mq.matches ? 'dark' : 'light')
      handler()
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }

    applyTheme(settings.theme)
  }, [settings.theme])

  return <>{children}</>
}
