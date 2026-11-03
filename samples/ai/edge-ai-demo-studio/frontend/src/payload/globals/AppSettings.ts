// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { GlobalConfig } from 'payload'
import {
  APP_SETTINGS_DEFAULTS,
  MIN_TIMEOUT_SECONDS,
  THEMES,
} from '@/lib/settings/app-settings'
import { encryptedFieldHooks } from '../fields/encrypted'

export const AppSettings: GlobalConfig = {
  slug: 'app-settings',
  label: 'App Settings',
  admin: {
    hidden: true,
  },
  fields: [
    {
      name: 'hfToken',
      label: 'Hugging Face Token',
      type: 'text',
      defaultValue: APP_SETTINGS_DEFAULTS.hfToken,
      access: {
        read: () => false,
      },
      hooks: encryptedFieldHooks,
    },
    {
      name: 'startupTimeout',
      label: 'Startup Timeout (seconds)',
      type: 'number',
      defaultValue: APP_SETTINGS_DEFAULTS.startupTimeout,
      min: MIN_TIMEOUT_SECONDS,
    },
    {
      name: 'theme',
      label: 'Theme',
      type: 'select',
      options: THEMES.map((value) => ({
        label: value[0].toUpperCase() + value.slice(1),
        value,
      })),
      defaultValue: APP_SETTINGS_DEFAULTS.theme,
    },
    {
      name: 'proxyTimeout',
      label: 'Proxy Timeout (seconds)',
      type: 'number',
      defaultValue: APP_SETTINGS_DEFAULTS.proxyTimeout,
      min: MIN_TIMEOUT_SECONDS,
    },
  ],
}
