// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from 'react'

export type Theme = 'light' | 'dark' | 'system'

export interface Settings {
  theme: Theme
  hfToken: string
}

interface SettingsContextValue {
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => void
  resetSettings: () => void
}

const defaultSettings: Settings = {
  theme: 'system',
  hfToken: '',
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [userOverrides, setUserOverrides] = useState<Partial<Settings>>({})

  const { data: themeData } = useQuery({
    queryKey: ['settings', 'theme'],
    queryFn: (): Promise<{ theme: Theme }> =>
      fetch('/api/settings/theme').then((r) => r.json()),
  })

  const settings = useMemo<Settings>(
    () => ({
      ...defaultSettings,
      ...(themeData?.theme && { theme: themeData.theme }),
      ...userOverrides,
    }),
    [themeData, userOverrides],
  )

  const { mutate: saveTheme } = useMutation({
    mutationFn: (theme: Theme) =>
      fetch('/api/settings/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      }).then((r) => r.json()),
  })

  const updateSettings = (partial: Partial<Settings>) => {
    setUserOverrides((prev) => ({ ...prev, ...partial }))
    if (partial.theme !== undefined) {
      saveTheme(partial.theme)
    }
  }

  const resetSettings = () => {
    setUserOverrides({})
    saveTheme(defaultSettings.theme)
  }

  return (
    <SettingsContext.Provider
      value={{ settings, updateSettings, resetSettings }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
