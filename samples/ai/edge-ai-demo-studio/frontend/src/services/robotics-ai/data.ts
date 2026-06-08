// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Image } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'

export const service: ServiceMeta = {
  id: 'robotics-ai',
  name: 'Robotics AI',
  description:
    'A demo showcasing the capabilities of Robotics AI, including real-time object detection and manipulation.',
  longDescription:
    'Robotics AI integrates advanced computer vision and machine learning techniques to enable robots to perceive and interact with their environment. This demo highlights features such as object detection, manipulation, and task execution in real-time.',
  icon: Image,
  port: 8025,
  supportedOS: ['linux'],
  execution: { mode: 'worker' },
  logSources: [
    {
      type: 'service',
      label: 'robotics-ai',
      target: 'robotics-ai',
    },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
  hidden: true,
}

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => {
    return ['--port', String(doc.port)]
  },
  workerSubDir: 'robotics-ai',
}
