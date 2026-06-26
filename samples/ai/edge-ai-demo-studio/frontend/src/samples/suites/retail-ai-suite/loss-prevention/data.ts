// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Sample } from '@/samples/types'
import { lossPreventionSuite } from './config'
import { LossPreventionDemo } from './demo'
import sampleImage from './image.png'

export const sample: Sample = {
  id: 'loss-prevention',
  title: 'Loss Prevention',
  description:
    'Detect and classify retail products in real time using YOLO11n object detection and EfficientNet-B0 classification.',
  longDescription:
    'A Retail AI Suite reference application demonstrating Combined Detection and Classification for loss prevention at the edge. DL Streamer streams RTSP video through a YOLO11n detection pipeline and an EfficientNet-B0 classification pipeline powered by OpenVINO, producing annotated output in a visual display window. The full suite is brought up with `docker compose`.',
  category: ['Suite', 'Retail AI Suite'],
  dependencies: [{ serviceId: 'loss-prevention', role: 'required' }],
  tags: [
    lossPreventionSuite.edgeAiSuitesVersionTag,
    'Retail AI Suite',
    'Loss Prevention',
    'Object Detection',
    'Classification',
    'DL Streamer',
    'Docker',
  ],
  supportedOS: ['linux'],
  image: sampleImage,
  demo: {
    type: 'component',
    component: LossPreventionDemo,
  },
  docs: {
    filePath: 'src/samples/suites/retail-ai-suite/loss-prevention/doc.md',
  },
}
