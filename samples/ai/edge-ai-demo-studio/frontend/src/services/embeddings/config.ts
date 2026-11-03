// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ModelOption, Service, ServiceConfig } from '@/services/types'
import { getEffectiveModel } from '@/types/service'
import { getMultiserveServiceConfig } from '../../engines/multiserve/config'

/**
 * Text Embedding runs on `multiserve` (text only, OVMS or llama.cpp) or `worker` (the OEP
 * multimodal-embedding-serving microservice, where CLIP/SigLIP embed text and images). Both answer
 * OpenAI `POST /v1/embeddings`; only the demo cares which, via `getEmbeddingCapabilities`.
 */

export const DEFAULT_OEP_EMBEDDING_MODEL = 'CLIP/clip-vit-b-16'

interface OepEmbeddingModel extends ModelOption {
  dimensions: number
  image: boolean
}

/**
 * Upstream ids. CLIP/SigLIP also compile for the NPU (static batch-16 shapes); the NPU driver
 * rejects the Qwen graph. MobileCLIP, CN-CLIP and BLIP-2 are git-only installs upstream, so the
 * native worker leaves them out.
 */
const OEP_EMBEDDING_MODELS: OepEmbeddingModel[] = [
  {
    value: 'CLIP/clip-vit-b-32',
    label: 'CLIP ViT-B/32 (text + image, OpenVINO, OEP)',
    availableDevices: ['AUTO', 'CPU', 'GPU', 'NPU'],
    backend: 'openvino',
    dimensions: 512,
    image: true,
  },
  {
    value: DEFAULT_OEP_EMBEDDING_MODEL,
    label: 'CLIP ViT-B/16 (text + image, OpenVINO, OEP)',
    availableDevices: ['AUTO', 'CPU', 'GPU', 'NPU'],
    backend: 'openvino',
    dimensions: 512,
    image: true,
  },
  {
    value: 'CLIP/clip-vit-l-14',
    label: 'CLIP ViT-L/14 (text + image, OpenVINO, OEP)',
    availableDevices: ['AUTO', 'CPU', 'GPU', 'NPU'],
    backend: 'openvino',
    weight: 'heavy',
    dimensions: 768,
    image: true,
  },
  {
    value: 'SigLIP/siglip2-vit-b-16',
    label: 'SigLIP2 ViT-B/16 (text + image, OpenVINO, OEP)',
    availableDevices: ['AUTO', 'CPU', 'GPU', 'NPU'],
    backend: 'openvino',
    dimensions: 768,
    image: true,
  },
  {
    value: 'SigLIP/siglip2-vit-l-16',
    label: 'SigLIP2 ViT-L/16 (text + image, OpenVINO, OEP)',
    availableDevices: ['AUTO', 'CPU', 'GPU', 'NPU'],
    backend: 'openvino',
    weight: 'heavy',
    dimensions: 1024,
    image: true,
  },
  {
    value: 'QwenText/qwen3-embedding-0.6b',
    label: 'Qwen3-Embedding 0.6B (text only, int8 OpenVINO, OEP)',
    availableDevices: ['AUTO', 'CPU', 'GPU'],
    backend: 'openvino',
    dimensions: 1024,
    image: false,
  },
]

const OEP_MODEL_VALUES = new Set(OEP_EMBEDDING_MODELS.map((m) => m.value))

export function isOepEmbeddingModel(model: string | undefined): boolean {
  if (!model) return false
  if (OEP_MODEL_VALUES.has(model)) return true
  // Any other upstream id ("<Family>/<name>"), e.g. set through deployment.json.
  return /^(CLIP|SigLIP|QwenText|MobileCLIP|CN-CLIP|Blip2)\//.test(model)
}

export interface EmbeddingCapabilities {
  /** The loaded model can embed images (CLIP / SigLIP families). */
  image: boolean
  source: 'oep' | 'multiserve'
}

export function getEmbeddingCapabilities(
  service: Pick<Service, 'engine'> & Parameters<typeof getEffectiveModel>[0],
): EmbeddingCapabilities {
  const model = getEffectiveModel(service).name
  if (service.engine !== 'worker' && !isOepEmbeddingModel(model)) {
    return { image: false, source: 'multiserve' }
  }
  const known = OEP_EMBEDDING_MODELS.find((m) => m.value === model)
  return {
    // Unknown upstream ids are assumed multimodal unless they are Qwen text.
    image: known ? known.image : !/^QwenText\//.test(model),
    source: 'oep',
  }
}

/** Multiserve's models plus the OEP ones. */
export const embeddingsConfig: ServiceConfig = (() => {
  const multiserve = getMultiserveServiceConfig('embeddings')
  return {
    ...multiserve,
    availableModels: [
      ...(multiserve.availableModels ?? []),
      ...OEP_EMBEDDING_MODELS.map(
        ({ dimensions: _d, image: _i, ...option }) => option,
      ),
    ],
  }
})()

/** Fixed export precision per family: CLIP via optimum (FP32), SigLIP via `ov.save_model` (FP16). */
const FIXED_PRECISION: Partial<Record<string, string>> = {
  CLIP: 'fp32',
  SigLIP: 'fp16',
}

/**
 * Worker configure panel config: OEP models only. Qwen text exports at the chosen `--precision` on
 * first start; CLIP/SigLIP at a fixed one.
 */
export const oepEmbeddingsConfig: ServiceConfig = {
  availableModels: OEP_EMBEDDING_MODELS.map(
    ({ dimensions: _d, image: _i, ...option }) => {
      const fixed = FIXED_PRECISION[option.value.split('/')[0]]
      return fixed ? { ...option, availableWeightFormats: [fixed] } : option
    },
  ),
  availableDevices: ['AUTO', 'CPU', 'GPU', 'NPU'],
  supportsCustomModel: false,
  availableWeightFormats: ['fp16', 'int8'],
  defaultWeightFormat: 'int8',
}
