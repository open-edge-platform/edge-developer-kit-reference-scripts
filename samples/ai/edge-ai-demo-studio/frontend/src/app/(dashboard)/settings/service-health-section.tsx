// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { APP_SETTINGS_DEFAULTS } from '@/lib/settings/app-settings'
import { type FieldState, SettingsSection } from './settings-section'
import { TimeoutField } from './timeout-field'

const DEFAULT = APP_SETTINGS_DEFAULTS.startupTimeout

export function ServiceHealthSection({
  startupTimeout,
  savedStartupTimeout,
  onTimeoutChange,
  state,
}: {
  startupTimeout: string
  /** Undefined until the saved value has loaded. */
  savedStartupTimeout: number | undefined
  onTimeoutChange: (value: string) => void
  state: FieldState
}) {
  return (
    <SettingsSection
      title="Service health"
      description="Configure health check and startup behavior."
      stagger={2}
      state={state}
    >
      <TimeoutField
        id="startup-timeout"
        label="Startup timeout"
        value={startupTimeout}
        savedSeconds={savedStartupTimeout}
        onChange={onTimeoutChange}
        description={`Maximum time a service can stay in "preparing" status before being marked as failed. Default is ${DEFAULT} seconds (${DEFAULT / 60} minutes).`}
      />
    </SettingsSection>
  )
}
