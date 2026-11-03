// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Search } from 'lucide-react'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { suiteHttpsPort } from '@/services/suites/ports'

export const service: ServiceMeta = {
  id: 'image-based-video-search',
  name: 'Image-Based Video Search',
  description:
    'Edge AI suite that searches video streams for objects matching a user-supplied reference image.',
  longDescription:
    'Metro AI Suite reference application that ingests RTSP video, runs object detection (YOLOv11s) and feature extraction (ResNet-50) via DL Streamer, indexes detections in Milvus, and exposes a web UI for image-based similarity search. Brought up via docker compose; the suite hosts its own UI at https://127.0.0.1/.',
  icon: Search,
  // http, https and rtsp ports are consecutive from the allocated base port
  portBlock: 3,
  supportedOS: ['linux'],
  execution: { mode: 'worker' },
  healthCheck: {
    url: '/nginx_healthz',
  },
  defaultModel: {
    name: 'image-based-video-search',
    device: 'CPU',
  },
  hidden: true,
  logSources: [
    {
      type: 'service',
      label: 'image-based-video-search',
      target: 'image-based-video-search',
    },
  ],
}

export const worker: WorkerConfig = {
  // The compose wrapper rejects flags it does not know.
  acceptsInstanceArgs: false,
  buildArgs: (doc) => {
    const port = doc.port
    if (port == null) throw new Error('Service port is not configured')
    return [
      '--http-port',
      String(port),
      '--https-port',
      String(suiteHttpsPort(port)),
      '--rtsp-port',
      String(port + 2),
      '--device',
      doc.models.default.device,
    ]
  },
  workerSubDir: 'suites/metro-ai-suite/image-based-video-search',
  requiresDocker: true,
  stopScript: true,
}
