// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { GlobalConfig } from 'payload'

/**
 * Per-sample settings. `instances` binds a sample to the service instances it uses:
 * `{ [sampleId]: { [serviceType]: <services row id> } }`.
 */
export const SampleSettings: GlobalConfig = {
  slug: 'sample-settings',
  label: 'Sample Settings',
  admin: {
    hidden: true,
  },
  fields: [
    {
      name: 'instances',
      label: 'Instance bindings',
      type: 'json',
      defaultValue: {},
      jsonSchema: {
        uri: 'a://b/sample-settings-instances.json',
        fileMatch: ['a://b/sample-settings-instances.json'],
        schema: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            additionalProperties: { type: 'integer' },
          },
        },
      },
    },
  ],
}
