// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Sample } from '@/samples/types'
import { palletDefectDetectionSuite } from './config'
import { PalletDefectDetectionDemo } from './demo'
import sampleImage from './image.png'

export const sample: Sample = {
  id: 'pallet-defect-detection',
  title: 'Pallet Defect Detection',
  description:
    'Detect pallet defects in real time on a warehouse video stream using DL Streamer and OpenVINO.',
  longDescription:
    'A Manufacturing AI Suite reference application built on the Industrial Edge Insights for Vision template. DL Streamer Pipeline Server runs an OpenVINO INT8 detection model against a warehouse video, publishes the annotated stream over WebRTC via MediaMTX, and exposes telemetry through OpenTelemetry/Prometheus. The full suite is brought up with `docker compose` and serves its own web UI.',
  category: ['Suite', 'Manufacturing AI Suite'],
  dependencies: [{ serviceId: 'pallet-defect-detection', role: 'required' }],
  tags: [
    palletDefectDetectionSuite.edgeAiSuitesVersionTag,
    'Manufacturing AI Suite',
    'Industrial Edge Insights',
    'Vision',
    'Defect Detection',
    'DL Streamer',
    'WebRTC',
    'Docker',
  ],
  supportedOS: ['linux'],
  image: sampleImage,
  demo: {
    type: 'component',
    component: PalletDefectDetectionDemo,
  },
  docs: {
    filePath:
      'src/samples/suites/manufacturing-ai-suite/pallet-defect-detection/doc.md',
  },
}
