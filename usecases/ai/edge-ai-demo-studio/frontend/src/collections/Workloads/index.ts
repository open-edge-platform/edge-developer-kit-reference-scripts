// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { CollectionConfig } from 'payload'
import {
  deleteWorkloadAfterDelete,
  afterWorkloadChange,
} from '@/hooks/workload'
import { WorkloadEndpoints } from './endpoints'
import { WAKE_WORD_DETECTION_TYPE } from '@/lib/workloads/wake-word-detection'
import { SPEECH_TO_TEXT_TYPE } from '@/lib/workloads/speech-to-text'
import { TEXT_GENERATION_TYPE } from '@/lib/workloads/text-generation'
import { EMBEDDING_TYPE } from '@/lib/workloads/embedding'
import { TEXT_TO_SPEECH_TYPE } from '@/lib/workloads/text-to-speech'
import { LIPSYNC_TYPE } from '@/lib/workloads/lipsync'
import { IMAGE_GENERATION_TYPE } from '@/lib/workloads/image-generation'

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
        { label: 'Wake Word Detection', value: WAKE_WORD_DETECTION_TYPE },
        { label: 'Speech-To-Text', value: SPEECH_TO_TEXT_TYPE },
        { label: 'Embedding', value: EMBEDDING_TYPE },
        { label: 'Text Generation', value: TEXT_GENERATION_TYPE },
        { label: 'Text-To-Speech', value: TEXT_TO_SPEECH_TYPE },
        { label: 'Lipsync', value: LIPSYNC_TYPE },
        { label: 'Image Generation', value: IMAGE_GENERATION_TYPE },
      ],
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
      required: true,
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
            turnServerIp: {
              type: 'string',
              description: 'Turn Server IP for Lipsync',
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
                'Map of Workload field paths to JSONata expressions for validation against the response',
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
      options: [
        { label: 'Llama.cpp', value: 'llamacpp' },
        { label: 'OVMS', value: 'ovms' },
        { label: 'Custom', value: 'custom' }, //This is for workloads with no specific engine
      ],
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
    afterDelete: [deleteWorkloadAfterDelete],
    afterChange: [afterWorkloadChange],
  },
  endpoints: WorkloadEndpoints,
}
