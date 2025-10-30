// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { CollectionConfig } from 'payload'
import {
  deleteWorkloadAfterDelete,
  afterWorkloadChange,
} from '@/hooks/workload'
import { WorkloadEndpoints } from './endpoints'

export const Workloads: CollectionConfig = {
  slug: 'workloads',
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'type',
      type: 'select',
      options: [
        { label: 'Speech-To-Text', value: 'speech-to-text' },
        { label: 'Embedding', value: 'embedding' },
        { label: 'Text Generation', value: 'text-generation' },
        { label: 'Text-To-Speech', value: 'text-to-speech' },
        { label: 'Lipsync', value: 'lipsync' },
      ],
      required: true,
    },
    {
      name: 'model',
      type: 'text',
      required: true,
    },
    {
      name: 'port',
      type: 'number',
      required: true,
      unique: true,
    },
    {
      name: 'device',
      type: 'text',
      defaultValue: 'CPU',
      required: true,
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
            denoise_model: {
              type: 'string',
            },
            denoise_device: {
              type: 'string',
            },
            rerankerModel: {
              type: 'string',
            },
            rerankerDevice: {
              type: 'string',
            },
            turnServerIp: {
              type: 'string',
              description: 'Turn Server IP for Lipsync',
            },
            languageCode: {
              type: 'string',
              description: 'Language Code for TTS',
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
      name: 'healthUrl',
      type: 'text',
      required: false,
    },
    {
      name: 'isHealthy',
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
    afterDelete: [deleteWorkloadAfterDelete],
    afterChange: [afterWorkloadChange],
  },
  endpoints: WorkloadEndpoints,
}
