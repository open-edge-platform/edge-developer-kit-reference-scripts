// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ImageUpscale } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import { getEffectivePrecision } from '@/services/model-config'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { DEFAULT_UPSCALING_MODEL, serviceConfig } from './config'

export const service: ServiceMeta = {
  id: 'image-upscaling',
  name: 'Image Upscaling',
  multiInstance: true,
  description:
    'Super-resolution: upscale images, videos and live webcam frames 2x-4x with Real-ESRGAN, SPAN, DAT2, AuraSR, Swin2SR or Intel OMZ, and photos with SeedVR2 diffusion.',
  longDescription:
    'AI super-resolution on OpenVINO, and on PyTorch for SeedVR2. Real-ESRGAN models restore detail in photos and anime at 2x or 4x, the compact ones fast enough to upscale a live webcam on a GPU; SPAN is the fastest on a CPU or NPU; DAT2, a transformer, restores the most natural detail in degraded photos and AuraSR, a 618M-parameter GAN, the richest texture, both best on a discrete GPU; Swin2SR, a transformer, upscales faithfully without inventing texture; the Open Model Zoo model from Intel keeps fine texture and runs live even on a CPU; and SeedVR2 3B, a one-step diffusion model run with PyTorch on an Intel GPU, restores the most detail in degraded photos and faces, for still images up to 800x600. Upload an image, queue a whole video (frame rate and audio kept), or watch the webcam upscaled live. Each PyTorch checkpoint but SeedVR2 is converted to OpenVINO on first start, at FP16 or INT8. All models are under licenses that allow commercial use: BSD-3-Clause, Apache-2.0, CC-BY-4.0 or CC-BY-SA-4.0.',
  icon: ImageUpscale,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: DEFAULT_UPSCALING_MODEL,
    device: 'AUTO',
  },
  config: serviceConfig,
  logSources: [
    { type: 'service', label: 'image-upscaling', target: 'image-upscaling' },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
}

export const worker: WorkerConfig = {
  modelCatalog: 'script',
  buildArgs: (doc: PayloadService) => [
    '--port',
    String(doc.port),
    '--model',
    doc.models?.default?.name || DEFAULT_UPSCALING_MODEL,
    '--device',
    doc.models?.default?.device || 'AUTO',
    '--precision',
    getEffectivePrecision(serviceConfig, doc.models?.default?.quant) ?? 'fp16',
  ],
  workerSubDir: 'services/image-upscaling',
  modelDirectories: ['models/upscaling'],
}
