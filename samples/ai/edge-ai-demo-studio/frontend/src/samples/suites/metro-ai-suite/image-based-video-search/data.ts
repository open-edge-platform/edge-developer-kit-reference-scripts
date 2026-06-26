// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Sample } from '@/samples/types'
import { imageBasedVideoSearchSuite } from './config'
import { ImageBasedVideoSearchDemo } from './demo'
import sampleImage from './image.png'

export const sample: Sample = {
  id: 'image-based-video-search',
  title: 'Image-Based Video Search',
  description:
    'Search live video streams for objects that match a reference image you upload.',
  longDescription:
    'A Metro AI Suite reference application demonstrating real-time video analytics on the edge: DL Streamer detects objects (YOLOv11s) and extracts ResNet-50 feature vectors from an RTSP stream, indexes them in Milvus, and lets you search the stream by uploading an image of the object you are looking for. The full suite is brought up with `docker compose` and serves its own web UI.',
  category: ['Suite', 'Metro AI Suite'],
  dependencies: [{ serviceId: 'image-based-video-search', role: 'required' }],
  tags: [
    imageBasedVideoSearchSuite.edgeAiSuitesVersionTag,
    'Metro AI Suite',
    'Vision',
    'Video Search',
    'Docker',
  ],
  supportedOS: ['linux'],
  image: sampleImage,
  demo: {
    type: 'component',
    component: ImageBasedVideoSearchDemo,
  },
  docs: {
    filePath:
      'src/samples/suites/metro-ai-suite/image-based-video-search/doc.md',
  },
}
