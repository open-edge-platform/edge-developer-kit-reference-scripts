// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Injected by vertical-reference-blueprint's scripts/bundle.sh — registers the kiosk as an
// Edge AI Studio service run as a background worker (workers/public-service-kiosk/start.sh).
import { Landmark } from 'lucide-react'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import type { Service as PayloadService } from '@/payload-types'

// The id is not part of the generated Payload union — the cast is deliberate.
const KIOSK_ID = 'public-service-kiosk' as PayloadService['type']

export const service: ServiceMeta = {
  id: KIOSK_ID,
  name: 'Public Service Kiosk',
  description:
    'Self-service government kiosk (touch / chat / agent terminals) running embedded in the studio.',
  longDescription:
    'The Public Service Kiosk as an embedded sample: the studio starts the bundled ' +
    'kiosk server (workers/public-service-kiosk) as a hidden background process and the kiosk ' +
    'consumes the studio’s own AI services (text generation, OCR, face ' +
    'recognition, speech) over the local gateway.',
  icon: Landmark,
  port: __KIOSK_PORT__,
  supportedOS: ['linux'],
  execution: { mode: 'worker' },
  healthCheck: { url: '/api/health' },
  defaultModel: { name: 'public-service-kiosk', device: 'CPU' },
  hidden: true,
  logSources: [{ type: 'service', label: 'public-service-kiosk', target: 'public-service-kiosk' }],
}

export const worker: WorkerConfig = {
  buildArgs: (doc) => ['--port', String(doc.port ?? __KIOSK_PORT__)],
  workerSubDir: 'public-service-kiosk',
}
