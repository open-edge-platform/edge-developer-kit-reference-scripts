// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload'

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
      name: 'apiKey',
      type: 'text',
      required: false,
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
}
