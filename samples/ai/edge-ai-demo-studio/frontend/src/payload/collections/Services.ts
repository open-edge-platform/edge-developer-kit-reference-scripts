// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig, JSONField } from 'payload'
import { MODEL_SOURCES } from '@/lib/deployment/deployment-schema'
import { metadataFieldsFor } from '@/lib/instances/service-metadata'
import {
  getEngineOptionsMap,
  getServiceNamesMap,
} from '@/services/config-registry'
import {
  afterServiceChange,
  deleteServiceAfterDelete,
  validateInstanceFields,
} from './hooks/service-hooks'

type JSONSchema = NonNullable<JSONField['jsonSchema']>['schema']

// A model entry of `models`: the default one also names its backend and
// type; any other entry only its own name, source, quant, device and params.
const modelProperties: Record<string, JSONSchema> = {
  name: { type: 'string' },
  source: { type: 'string', enum: [...MODEL_SOURCES] },
  quant: { type: 'string' },
  device: { type: 'string' },
  params: { type: 'string' },
}
const modelEntrySchema = (
  properties: Record<string, JSONSchema>,
): JSONSchema => ({
  type: 'object',
  required: ['name', 'device'],
  additionalProperties: false,
  properties,
})

/** The editor-only id of a field's JSON Schema; each must be distinct. */
const schemaUri = (name: string) => `a://services/${name}.json`

export const Services: CollectionConfig = {
  slug: 'services',
  // validateInstanceFields explains a clash; this keeps two racing writes
  // from both getting through.
  indexes: [{ fields: ['type', 'instanceId'], unique: true }],
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'type',
      type: 'select',
      options: getServiceNamesMap(),
      required: true,
    },
    {
      // Addressed as `/api/<type>@<instanceId>`. Derived from the name when omitted at creation
      // and fixed from then on: renaming changes only `label`.
      name: 'instanceId',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'label',
      type: 'text',
      required: false,
    },
    {
      name: 'models',
      type: 'json',
      required: true,
      jsonSchema: {
        uri: schemaUri('models'),
        fileMatch: [schemaUri('models')],
        schema: {
          type: 'object',
          required: ['default'],
          properties: {
            default: modelEntrySchema({
              ...modelProperties,
              backend: { type: 'string' },
              type: { type: 'string' },
            }),
          },
          patternProperties: {
            '^(?!default$).*': modelEntrySchema(modelProperties),
          },
        },
      },
    },
    {
      name: 'port',
      type: 'number',
      required: false,
      unique: true,
    },
    {
      name: 'metadata',
      type: 'json',
      required: false,
      jsonSchema: {
        uri: schemaUri('metadata'),
        fileMatch: [schemaUri('metadata')],
        schema: {
          type: 'object',
          properties: metadataFieldsFor(),
        },
      },
    },

    {
      name: 'status',
      type: 'select',
      options: [
        { label: 'Prepare', value: 'prepare' },
        { label: 'Active', value: 'active' },
        { label: 'Inactive', value: 'inactive' },
        { label: 'Restart', value: 'restart' },
        { label: 'Error', value: 'error' },
      ],
      defaultValue: 'prepare',
    },
    {
      name: 'statusMessage',
      type: 'text',
    },
    {
      name: 'healthCheck',
      type: 'json',
      required: false,
      jsonSchema: {
        uri: schemaUri('health-check'),
        fileMatch: [schemaUri('health-check')],
        schema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Health check endpoint URL',
            },
            responseMapper: {
              type: 'object',
              additionalProperties: {
                type: 'string',
              },
              description:
                'Map of Service field paths to JSONata expressions for validation against the response',
            },
          },
          required: ['url'],
        },
      },
    },
    {
      name: 'isHealthy',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'engine',
      type: 'select',
      options: getEngineOptionsMap(),
      required: true,
    },
  ],
  access: {
    create: () => true,
    read: () => true,
    update: () => true,
    delete: () => true,
  },
  hooks: {
    beforeValidate: [validateInstanceFields],
    afterDelete: [deleteServiceAfterDelete],
    afterChange: [afterServiceChange],
  },
}
