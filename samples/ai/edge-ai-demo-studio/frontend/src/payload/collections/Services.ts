// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload'
import {
  getEngineOptionsMap,
  getServiceNamesMap,
} from '@/services/config-registry'
import {
  afterServiceChange,
  deleteServiceAfterDelete,
} from './hooks/service-hooks'

export const Services: CollectionConfig = {
  slug: 'services',
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
      name: 'models',
      type: 'json',
      required: true,
      jsonSchema: {
        uri: 'a://b/foo.json', // required
        fileMatch: ['a://b/foo.json'], // required
        schema: {
          type: 'object',
          required: ['default'],
          properties: {
            default: {
              type: 'object',
              required: ['name', 'device'],
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                source: {
                  type: 'string',
                  enum: ['huggingface', 'modelscope', 'custom'],
                },
                quant: { type: 'string' },
                device: { type: 'string' },
                params: { type: 'string' },
                backend: { type: 'string' },
                type: { type: 'string' },
              },
            },
          },
          patternProperties: {
            '^(?!default$).*': {
              type: 'object',
              required: ['name', 'device'],
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                source: {
                  type: 'string',
                  enum: ['huggingface', 'modelscope', 'custom'],
                },
                quant: { type: 'string' },
                device: { type: 'string' },
                params: { type: 'string' },
              },
            },
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
        uri: 'a://b/foo.json', // required
        fileMatch: ['a://b/foo.json'], // required
        schema: {
          type: 'object',
          properties: {
            clientIceServerUrl: {
              type: 'string',
              description: 'Client-side ICE server URL (default: STUN)',
            },
            serverIceServerUrl: {
              type: 'string',
              description: 'Server-side ICE server URL (default: TURN)',
            },
            turnServerIp: {
              type: 'string',
              description:
                'Deprecated: Use clientIceServerUrl / serverIceServerUrl instead',
            },
            languageCode: {
              type: 'string',
              description: 'Language Code for TTS',
            },
            vadThreshold: {
              type: 'number',
              default: 0.2,
              description: 'VAD Threshold for Wake Word Detection',
            },
            cpuAffinity: {
              type: 'string',
              description:
                'CPU cores to pin this service to (numactl -C format, e.g. "0-7" or "0,2,4"). Empty / missing = all cores. Linux only.',
            },
          },
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
        uri: 'a://b/foo.json', // required
        fileMatch: ['a://b/foo.json'], // required
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
    afterDelete: [deleteServiceAfterDelete],
    afterChange: [afterServiceChange],
  },
}
