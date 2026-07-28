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
  proxyTimeout: number
  activeProxyTimeout?: number
}

interface SettingsContextValue {
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => void
  resetSettings: () => void
}

const defaultSettings: Settings = {
  theme: 'system',
  proxyTimeout: 300,
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [userOverrides, setUserOverrides] = useState<Partial<Settings>>({})

  const { data: themeData } = useQuery({
    queryKey: ['settings', 'theme'],
    queryFn: (): Promise<{ theme: Theme }> =>
      fetch('/api/settings/theme').then((r) => r.json()),
  })

  const { data: proxyTimeoutData } = useQuery({
    queryKey: ['settings', 'proxyTimeout'],
    queryFn: (): Promise<{
      proxyTimeout: number
      activeProxyTimeout: number
    }> => fetch('/api/settings/proxy-timeout').then((r) => r.json()),
  })

  const settings = useMemo<Settings>(
    () => ({
      ...defaultSettings,
      ...(themeData?.theme && { theme: themeData.theme }),
      ...(proxyTimeoutData?.proxyTimeout && {
        proxyTimeout: proxyTimeoutData.proxyTimeout,
      }),
      ...(proxyTimeoutData?.activeProxyTimeout !== undefined && {
        activeProxyTimeout: proxyTimeoutData.activeProxyTimeout,
      }),
      ...userOverrides,
    }),
    [themeData, proxyTimeoutData, userOverrides],
  )

  const { mutate: saveTheme } = useMutation({
    mutationFn: (theme: Theme) =>
      fetch('/api/settings/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      }).then((r) => r.json()),
  })

  const { mutate: saveProxyTimeout } = useMutation({
    mutationFn: (proxyTimeout: number) =>
      fetch('/api/settings/proxy-timeout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxyTimeout }),
      }).then((r) => r.json()),
  })

  const updateSettings = (partial: Partial<Settings>) => {
    setUserOverrides((prev) => ({ ...prev, ...partial }))
    if (partial.theme !== undefined) {
      saveTheme(partial.theme)
    }
    if (partial.proxyTimeout !== undefined) {
      saveProxyTimeout(partial.proxyTimeout)
    }
  }

  const resetSettings = () => {
    setUserOverrides({})
    saveTheme(defaultSettings.theme)
    saveProxyTimeout(defaultSettings.proxyTimeout)
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
