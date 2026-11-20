// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Clapperboard } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import { getEffectivePrecision } from '@/services/model-config'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { DEFAULT_VIDEO_MODEL, serviceConfig } from './config'

export const service: ServiceMeta = {
  id: 'video-generation',
  name: 'Video Generation',
  multiInstance: true,
  // Finished videos and drafts stay readable while the instance is stopped.
  keepDemoWhenStopped: true,
  description:
    'Generate short videos from a text prompt, a start image or the poses of a driving video, with Wan2.2 and Wan2.1 on OpenVINO or PyTorch.',
  longDescription:
    'Text-to-video and image-to-video with the Wan family of diffusion transformers: FastWan2.2 TI2V 5B (a 3-step distilled Wan2.2: 5 s of 720p in about 40 s on an Intel Arc Pro B60), Wan2.2 TI2V 5B, Wan2.2 T2V A14B (two 14B transformers, one for the noisy early steps and one for the details; INT8 runs on a 24 GB GPU), Wan2.1 T2V 1.3B, and Wan2.1 VACE 1.3B, which makes a video follow the poses of someone in a video you upload (drawn with DWPose), optionally as the person in an image you give. The 5B models run with PyTorch on an Intel GPU (XPU), three times faster than OpenVINO at 720p; the others on OpenVINO (converted on first start, INT8 by default; on any Intel GPU or the CPU). Videos are decoded by a distilled tiny decoder about 30 times faster than the original VAE, fast enough to show the video the model expects after every denoising step as it is made, and to scrub through the steps afterwards. OpenAI-compatible Videos API. All models, decoders and pose models (YOLOX, DWPose) are under the Apache-2.0 license.',
  icon: Clapperboard,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: DEFAULT_VIDEO_MODEL,
    device: 'XPU',
  },
  config: serviceConfig,
  logSources: [
    { type: 'service', label: 'video-generation', target: 'video-generation' },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
}

export const worker: WorkerConfig = {
  modelCatalog: 'script',
  buildArgs: (doc: PayloadService) => {
    const args = [
      '--port',
      String(doc.port),
      '--model',
      doc.models?.default?.name || DEFAULT_VIDEO_MODEL,
      // XPU runs PyTorch; any other device (AUTO, GPU.1, CPU) runs OpenVINO.
      '--device',
      doc.models?.default?.device || 'AUTO',
    ]
    const precision = getEffectivePrecision(
      serviceConfig,
      doc.models?.default?.quant,
    )
    if (precision) args.push('--precision', precision)
    return args
  },
  workerSubDir: 'services/video-generation',
  // Repository mirrors under hf/, OpenVINO exports and their compile cache.
  modelDirectories: ['models/video-generation'],
}
