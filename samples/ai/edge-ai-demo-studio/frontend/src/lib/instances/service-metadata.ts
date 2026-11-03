// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Service } from '@/payload-types'

/**
 * Per-instance settings a service reads besides its model, typed from `SERVICE_METADATA_FIELDS`;
 * undocumented keys read as `unknown`. Isomorphic.
 */
export type ServiceMetadata = NonNullable<Service['metadata']>

export function getServiceMetadata(service: {
  metadata?: unknown
}): ServiceMetadata {
  return (service.metadata as ServiceMetadata | null | undefined) ?? {}
}

/** Keys are taken as they come: the worker reading a key checks its value. */
export function mergeServiceMetadata(
  base: Service['metadata'],
  update: Record<string, unknown>,
): ServiceMetadata {
  return { ...base, ...update } as ServiceMetadata
}

/** One metadata key's JSON Schema (a JSONSchema4 property). */
export interface MetadataFieldSchema {
  type: 'string' | 'number' | 'boolean'
  description: string
  enum?: string[]
  default?: string | number | boolean
}

/**
 * Every documented metadata key: its JSON Schema (which types `Service['metadata']`) and the service
 * types it applies to (all when `services` is absent).
 */
const SERVICE_METADATA_FIELDS: Record<
  string,
  { schema: MetadataFieldSchema; services?: readonly Service['type'][] }
> = {
  clientIceServerUrl: {
    schema: {
      type: 'string',
      description: 'Client-side ICE server URL (default: STUN)',
    },
    services: ['lipsync'],
  },
  serverIceServerUrl: {
    schema: {
      type: 'string',
      description: 'Server-side ICE server URL (default: TURN)',
    },
    services: ['lipsync'],
  },
  turnServerIp: {
    schema: {
      type: 'string',
      description:
        'Deprecated: Use clientIceServerUrl / serverIceServerUrl instead',
    },
    services: ['lipsync'],
  },
  languageCode: {
    schema: { type: 'string', description: 'Language Code for TTS' },
    services: ['text-to-speech'],
  },
  vadThreshold: {
    schema: {
      type: 'number',
      default: 0.2,
      description: 'VAD Threshold for Wake Word Detection',
    },
    services: ['wake-word-detection'],
  },
  cpuAffinity: {
    schema: {
      type: 'string',
      description:
        'CPU cores to pin this service to (numactl -C format, e.g. "0-7" or "0,2,4"). Empty / missing = all cores. Linux, and Windows for CPUs 0-63.',
    },
  },
  frameGeneration: {
    schema: {
      type: 'boolean',
      default: true,
      description:
        'Allow lipsync frame generation (interpolation). Only activates when the accelerator cannot infer enough frames per second on its own.',
    },
    services: ['lipsync'],
  },
  batchSize: {
    schema: {
      type: 'number',
      description:
        'Frames per lipsync inference. Empty / missing = automatic: 8 on the NPU, 16 on other devices. Smaller batches start talking sooner; larger ones can infer more frames per second.',
    },
    services: ['lipsync'],
  },
  sttBackend: {
    schema: {
      type: 'string',
      enum: ['oep', 'ovms'],
      default: 'oep',
      description:
        'Backend of the Speech to Text service: "oep" runs the Open Edge Platform audio-analyzer natively (Whisper on OpenVINO GenAI, streaming and live /v1/realtime); "ovms" runs the built-in OpenVINO Model Server worker (batch transcription and translation, optional noise suppression).',
    },
    services: ['speech-to-text'],
  },
  vectorDbBackend: {
    schema: {
      type: 'string',
      enum: ['faiss', 'pgvector'],
      default: 'faiss',
      description:
        'Vector store for the Vector Database service: "faiss" keeps an index per knowledge base on disk; "pgvector" stores vectors in PostgreSQL + pgvector through the OEP document-ingestion pipeline.',
    },
    services: ['vectordb'],
  },
  pgConnectionString: {
    schema: {
      type: 'string',
      description:
        'PostgreSQL URL for the pgvector backend. Empty / missing = embedded PostgreSQL managed by the worker.',
    },
    services: ['vectordb'],
  },
  embeddingBatchSize: {
    schema: {
      type: 'number',
      description:
        'Inputs per inference of the Open Edge Platform embeddings worker (INFER_BATCH_SIZE). Empty / missing = 64 on GPU, 16 on other devices; the NPU keeps its static batch of 16.',
    },
    services: ['embeddings'],
  },
  performanceMode: {
    schema: {
      type: 'string',
      enum: ['LATENCY', 'THROUGHPUT'],
      description:
        'OpenVINO performance hint of the Open Edge Platform embeddings worker (OV_PERFORMANCE_MODE). Empty / missing = THROUGHPUT on GPU, LATENCY on other devices.',
    },
    services: ['embeddings'],
  },
  compiledModelCache: {
    schema: {
      type: 'boolean',
      default: false,
      description:
        'Keep the compiled OpenVINO model of the Open Edge Platform embeddings worker on CPU and GPU too (OV_ENABLE_MODEL_CACHE), so restarts skip compiling. The NPU always caches.',
    },
    services: ['embeddings'],
  },
  denoiseDevice: {
    schema: {
      type: 'string',
      description:
        "Device of the noise suppression model on the OpenVINO Model Server backend of Speech to Text. Empty / missing = models.denoise.device, else the speech model's device. The worker falls back to CPU when the model cannot compile there.",
    },
    services: ['speech-to-text'],
  },
  serverArgs: {
    schema: {
      type: 'string',
      description:
        "Extra arguments the model server starts with, as typed (quote values with spaces): llama-server flags, which replace the engine's own, or OpenVINO Model Server graph options (ovms --pull). Flags the engine sets itself (port, host, model) are refused.",
    },
    services: ['text-generation', 'embeddings', 'rerank'],
  },
}

/** The metadata keys (with their schemas) that apply to `type`; all without one. */
export function metadataFieldsFor(
  type?: Service['type'],
): Record<string, MetadataFieldSchema> {
  return Object.fromEntries(
    Object.entries(SERVICE_METADATA_FIELDS)
      .filter(
        ([, field]) =>
          type === undefined ||
          !field.services ||
          field.services.includes(type),
      )
      .map(([key, field]) => [key, field.schema]),
  )
}
