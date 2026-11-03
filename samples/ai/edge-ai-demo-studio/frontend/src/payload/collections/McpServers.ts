// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  type CollectionBeforeValidateHook,
  type CollectionConfig,
  ValidationError,
} from 'payload'
import { checkMcpServerUrl } from '@/lib/llm/mcp-url'
import type { McpServer } from '@/payload-types'
import { encryptedFieldHooks } from '../fields/encrypted'

/**
 * Applies the probe's MCP address policy. Only a new or changed URL is checked, so an older row can
 * still be toggled or renamed.
 */
const validateServerUrl: CollectionBeforeValidateHook<McpServer> = ({
  data,
  originalDoc,
  req,
}) => {
  if (data?.url === undefined || data.url === originalDoc?.url) return data
  const checked = checkMcpServerUrl(data.url)
  if (!checked.ok) {
    throw new ValidationError({
      collection: 'mcp-servers',
      errors: [{ path: 'url', message: checked.error }],
      req,
    })
  }
  return { ...data, url: data.url.trim() }
}

export const McpServers: CollectionConfig = {
  slug: 'mcp-servers',
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'url',
      type: 'text',
      required: true,
    },
    {
      // Encrypted, never returned by REST (read via the local API). `apiKey: null` removes it;
      // leaving it out of an update keeps it.
      name: 'apiKey',
      type: 'text',
      required: false,
      access: {
        read: () => false,
      },
      hooks: {
        beforeChange: encryptedFieldHooks.beforeChange,
        afterRead: [
          ...encryptedFieldHooks.afterRead,
          // Runs before this field's read access drops the value.
          ({ value, siblingData }) => {
            siblingData.hasApiKey = Boolean(value)
            return value
          },
        ],
      },
    },
    {
      name: 'hasApiKey',
      type: 'checkbox',
      virtual: true,
      admin: { readOnly: true },
    },
    {
      name: 'disabled',
      type: 'checkbox',
      defaultValue: false,
    },
  ],
  access: {
    create: () => true,
    read: () => true,
    update: () => true,
    delete: () => true,
  },
  hooks: {
    beforeValidate: [validateServerUrl],
  },
}
