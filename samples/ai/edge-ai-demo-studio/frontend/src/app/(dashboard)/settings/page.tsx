// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useState } from 'react'
import { useSettings } from '@/context/settings-context'
import {
  ActionsBar,
  ApiConfigSection,
  AppearanceSection,
  ProxyConfigSection,
  ServiceHealthSection,
} from './components'
import {
  useHfToken,
  useSaveHfToken,
  useSaveStartupTimeout,
  useStartupTimeout,
} from './hooks'

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings()
  const [saved, setSaved] = useState(false)
  const [startupTimeoutDraft, setStartupTimeout] = useState<number | null>(null)
  const [hfTokenDraft, setHfTokenDraft] = useState<string | null>(null)

  const { data: timeoutData } = useStartupTimeout()
  const { data: hfTokenData } = useHfToken()

  const startupTimeout =
    startupTimeoutDraft ?? timeoutData?.startupTimeout ?? 600
  const hasToken = hfTokenData?.hasToken ?? false

  const showSaved = useCallback(() => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [])

  const { mutate: saveHfToken } = useSaveHfToken(() => {
    setHfTokenDraft(null)
    showSaved()
  })
  const { mutate: saveStartupTimeout } = useSaveStartupTimeout(showSaved)

  const handleSave = () => {
    if (hfTokenDraft !== null) {
      saveHfToken(hfTokenDraft)
    }
    saveStartupTimeout(startupTimeout)
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-foreground text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure your Edge AI Demo Studio preferences.
        </p>
      </div>

      <AppearanceSection
        theme={settings.theme}
        onThemeChange={(theme) => updateSettings({ theme })}
      />

      <ApiConfigSection
        hfToken={hfTokenDraft ?? ''}
        hasToken={hasToken}
        onTokenChange={setHfTokenDraft}
      />

      <ServiceHealthSection
        startupTimeout={startupTimeout}
        onTimeoutChange={setStartupTimeout}
      />

      <ProxyConfigSection
        activeProxyTimeout={settings.activeProxyTimeout}
        proxyTimeout={settings.proxyTimeout}
        onTimeoutChange={(proxyTimeout) => updateSettings({ proxyTimeout })}
      />

      <ActionsBar saved={saved} onSave={handleSave} />
    </div>
  )
}
