// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ShieldAlert } from 'lucide-react'
import type { ServiceMeta, WorkerConfig } from '@/services/types'

export const service: ServiceMeta = {
  id: 'loss-prevention',
  name: 'Loss Prevention',
  description:
    'Retail AI Suite that runs Combined Detection and Classification for loss prevention using GStreamer and OpenVINO.',
  longDescription:
    'Retail AI Suite reference application that streams RTSP video, runs object detection (YOLO11n) and classification (EfficientNet-B0) via DL Streamer and OpenVINO, and renders results in a visual window. Brought up via docker compose; pipeline output is displayed directly on the connected display.',
  icon: ShieldAlert,
  supportedOS: ['linux'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: 'loss-prevention',
    device: 'CPU',
  },
  // Docker compose auto-names the pipeline container as src-lp-pipeline-runner-1
  // (project = 'src', the working dir used by make run-lp, service = lp-pipeline-runner)
  healthCheck: {
    type: 'docker',
    container: 'src-lp-pipeline-runner-1',
    url: '',
  },
  hidden: true,
  logSources: [
    {
      type: 'service',
      label: 'loss-prevention',
      target: 'loss-prevention',
    },
  ],
}

export const worker: WorkerConfig = {
  buildArgs: (doc) => {
    const device = doc.models.default.device
    if (device === 'HETERO') {
      const meta = doc.metadata as Record<string, unknown> | undefined
      const detectDevice = String(meta?.detectDevice ?? 'CPU')
      const classifyDevice = String(meta?.classifyDevice ?? 'CPU')
      return [
        '--detect-device',
        detectDevice,
        '--classify-device',
        classifyDevice,
      ]
    }
    return ['--device', device]
  },
  workerSubDir: 'suite/retail-ai-suite/loss-prevention',
  requiresDocker: true,
  stopScript: true,
}
