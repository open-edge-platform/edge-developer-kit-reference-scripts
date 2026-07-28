// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FolderSync } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'

export const service: ServiceMeta = {
  id: 'file-watcher',
  name: 'File Watcher',
  description:
    'Watches a folder for new image files and broadcasts them over WebSocket for real-time processing.',
  longDescription:
    'Real-time file watcher service that monitors a configured folder for new image files using watchdog. Broadcasts each new file as a base64-encoded WebSocket message for downstream consumers such as the AI Exam Marking scanner.',
  icon: FolderSync,
  port: 8030,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  hidden: true,
  logSources: [
    { type: 'service', label: 'file-watcher', target: 'file-watcher' },
  ],
}

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => ['--port', String(doc.port)],
  workerSubDir: 'file-watcher',
}
