// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { APP_SETTINGS_DEFAULTS } from '@/lib/settings/app-settings'
import { type FieldState, SettingsSection } from './settings-section'
import { TimeoutField } from './timeout-field'

const DEFAULT = APP_SETTINGS_DEFAULTS.proxyTimeout

/**
 * The instance proxy reads the saved timeout on every request, so a saved
 * change applies to new requests at once — no restart to announce.
 */
export function ProxyConfigSection({
  proxyTimeout,
  savedProxyTimeout,
  onTimeoutChange,
  state,
}: {
  proxyTimeout: string
  /** Undefined until the saved value has loaded. */
  savedProxyTimeout: number | undefined
  onTimeoutChange: (value: string) => void
  state: FieldState
}) {
  return (
    <SettingsSection
      title="Proxy configuration"
      description="Configure proxy settings."
      stagger={3}
      state={state}
    >
      <TimeoutField
        id="proxy-timeout"
        label="Proxy timeout"
        value={proxyTimeout}
        savedSeconds={savedProxyTimeout}
        onChange={onTimeoutChange}
        description={`Maximum time a service may go without sending anything — while it works on an answer, or between two parts of a streamed one — before the request is terminated. Streams that keep sending are never cut off. Default is ${DEFAULT} seconds (${DEFAULT / 60} minutes). Raise it if a long request that returns nothing until it finishes times out. A saved change applies to new requests at once.`}
      />
    </SettingsSection>
  )
}
