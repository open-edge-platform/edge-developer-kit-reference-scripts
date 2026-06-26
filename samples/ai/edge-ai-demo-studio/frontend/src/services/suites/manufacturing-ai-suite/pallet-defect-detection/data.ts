// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Boxes } from 'lucide-react'
import type { ServiceMeta, WorkerConfig } from '@/services/types'

export const service: ServiceMeta = {
  id: 'pallet-defect-detection',
  name: 'Pallet Defect Detection',
  description:
    'Industrial AI suite that detects pallet defects in real time using DL Streamer Pipeline Server with WebRTC streaming.',
  longDescription:
    'Manufacturing AI Suite reference application built on the Industrial Edge Insights for Vision template. DL Streamer Pipeline Server runs a YOLO-based detection pipeline against a warehouse video, publishes frames over WebRTC via MediaMTX, stores frames/metadata in MinIO + MQTT, and exposes telemetry through OpenTelemetry/Prometheus. Brought up via docker compose; the suite hosts its own UI at https://localhost/.',
  icon: Boxes,
  port: 7004,
  reservedPorts: [7005, 7006, 7007],
  supportedOS: ['linux'],
  execution: { mode: 'worker' },
  healthCheck: {
    url: '/nginx_healthz',
  },
  defaultModel: {
    name: 'pallet-defect-detection',
    device: 'CPU',
  },
  hidden: true,
  logSources: [
    {
      type: 'service',
      label: 'pallet-defect-detection',
      target: 'pallet-defect-detection',
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
      '--coturn-port',
      String(port + 2),
      '--minio-port',
      String(port + 3),
      '--device',
      doc.models.default.device,
    ]
  },
  workerSubDir: 'suite/manufacturing-ai-suite/pallet-defect-detection',
  requiresDocker: true,
  stopScript: true,
}
