// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQuery } from '@tanstack/react-query'
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useState,
} from 'react'
import { fetchJson } from '@/lib/browser/fetch-json'
import type { Theme } from '@/lib/settings/app-settings'

/** Query key of the saved theme; the settings page saves through it. */
export const THEME_QUERY_KEY = ['settings', 'theme'] as const

function fetchTheme(): Promise<{ theme: Theme }> {
  return fetchJson('/api/settings/theme', {
    errorMessage: 'Failed to load the theme',
  })
}

interface ThemeContextValue {
  /** Shows a theme before it is saved; `null` goes back to the saved one. */
  previewTheme: (theme: Theme | null) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** The class a theme puts on `<html>`: `system` follows the OS. */
function resolveTheme(theme: Theme, prefersDark: boolean): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light'
  return theme
}

/**
 * Keeps the `light`/`dark` class on `<html>` in line with the saved (or previewed) theme, following
 * the OS for `system`. Starts from `initialTheme`, which the root layout already applied, so the
 * page never flips while the theme loads. A layout effect, so the class React's dev remount of
 * `<html>` clears is back before paint.
 */
export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: Theme
  children: ReactNode
}) {
  const { data } = useQuery({
    queryKey: THEME_QUERY_KEY,
    queryFn: fetchTheme,
    initialData: { theme: initialTheme },
  })
  const [preview, setPreview] = useState<Theme | null>(null)
  const theme = preview ?? data.theme

  useLayoutEffect(() => {
    const root = document.documentElement
    const apply = (resolved: 'light' | 'dark') => {
      root.classList.remove('light', 'dark')
      root.classList.add(resolved)
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => apply(resolveTheme(theme, media.matches))
    sync()
    if (theme !== 'system') return
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ previewTheme: setPreview }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useThemePreview(): ThemeContextValue['previewTheme'] {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useThemePreview must be used within ThemeProvider')
  return ctx.previewTheme
}
