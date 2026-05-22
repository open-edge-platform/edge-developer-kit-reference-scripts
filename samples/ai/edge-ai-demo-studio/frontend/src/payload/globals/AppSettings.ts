// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { FieldHook, GlobalConfig } from 'payload'
import { decryptField, encryptField } from '@/lib/field-encryption'

const encryptHook: FieldHook = ({ value }) => encryptField(value ?? '')
const decryptHook: FieldHook = ({ value }) => decryptField(value ?? '')

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
      defaultValue: '',
      access: {
        read: () => false,
      },
      hooks: {
        beforeChange: [encryptHook],
        afterRead: [decryptHook],
      },
    },
    {
      name: 'startupTimeout',
      label: 'Startup Timeout (seconds)',
      type: 'number',
      defaultValue: 600,
      min: 30,
    },
    {
      name: 'theme',
      label: 'Theme',
      type: 'select',
      options: [
        { label: 'Light', value: 'light' },
        { label: 'Dark', value: 'dark' },
        { label: 'System', value: 'system' },
      ],
      defaultValue: 'system',
    },
  ],
}
