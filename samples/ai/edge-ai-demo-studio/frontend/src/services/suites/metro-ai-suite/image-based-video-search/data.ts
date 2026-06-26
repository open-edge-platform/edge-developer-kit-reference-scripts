// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Search } from 'lucide-react'
import type { ServiceMeta, WorkerConfig } from '@/services/types'

export const service: ServiceMeta = {
  id: 'image-based-video-search',
  name: 'Image-Based Video Search',
  description:
    'Edge AI suite that searches video streams for objects matching a user-supplied reference image.',
  longDescription:
    'Metro AI Suite reference application that ingests RTSP video, runs object detection (YOLOv11s) and feature extraction (ResNet-50) via DL Streamer, indexes detections in Milvus, and exposes a web UI for image-based similarity search. Brought up via docker compose; the suite hosts its own UI at https://localhost/.',
  icon: Search,
  port: 7001,
  reservedPorts: [7002, 7003],
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
  buildArgs: (doc) => {
    const port = doc.port
    if (port == null) throw new Error('Service port is not configured')
    return [
      '--http-port',
      String(port),
      '--https-port',
      String(port + 1),
      '--rtsp-port',
      String(port + 2),
      '--device',
      doc.models.default.device,
    ]
  },
  workerSubDir: 'suite/metro-ai-suite/image-based-video-search',
  requiresDocker: true,
  stopScript: true,
}
