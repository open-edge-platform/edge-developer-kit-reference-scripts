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
  useSaveHfToken,
  useSaveStartupTimeout,
  useStartupTimeout,
} from './hooks'

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings()
  const [saved, setSaved] = useState(false)
  const [startupTimeoutDraft, setStartupTimeout] = useState<number | null>(null)

  const { data: timeoutData } = useStartupTimeout()

  const startupTimeout =
    startupTimeoutDraft ?? timeoutData?.startupTimeout ?? 600

  const showSaved = useCallback(() => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [])

  const { mutate: saveHfToken } = useSaveHfToken(showSaved)
  const { mutate: saveStartupTimeout } = useSaveStartupTimeout(showSaved)

  const handleSave = () => {
    saveHfToken(settings.hfToken)
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
        hfToken={settings.hfToken}
        onTokenChange={(hfToken) => updateSettings({ hfToken })}
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
