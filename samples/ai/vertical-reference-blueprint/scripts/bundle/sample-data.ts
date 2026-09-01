// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Injected by vertical-reference-blueprint's scripts/bundle.sh — the embedded kiosk's
// tile in the studio's samples gallery.
import type { Sample } from '@/samples/types'
import type { Service as PayloadService } from '@/payload-types'

export const sample: Sample = {
  id: 'public-service-kiosk',
  title: 'Public Service Kiosk',
  description:
    'A self-service government kiosk — touch, chat and voice-agent terminals with identity verification and AI document checks.',
  longDescription:
    'The Public Service Kiosk runs as a hidden child process managed by the studio, ' +
    'like the Edge AI suites: start the services below and the kiosk server boots ' +
    'alongside them, consuming the studio’s text-generation, OCR, ' +
    'face-recognition and speech services through the local gateway. Open the demo ' +
    'to use the kiosk in a new tab.',
  category: ['Suite'],
  dependencies: [
    // Literal id required: the exporter resolves dependencies by scanning for `serviceId: '<id>'`.
    { serviceId: 'public-service-kiosk' as PayloadService['type'], role: 'required' },
    { serviceId: 'text-generation', role: 'required' },
    { serviceId: 'ocr', role: 'required' },
    { serviceId: 'face-recognition', role: 'optional' },
    { serviceId: 'speech-to-text', role: 'optional' },
    { serviceId: 'text-to-speech', role: 'optional' },
  ],
  tags: ['Kiosk', 'Government Services', 'Touch', 'Chat', 'Agent', 'OCR'],
  supportedOS: ['linux'],
  demo: {
    type: 'external',
    externalUrl: 'http://localhost:__KIOSK_PORT__',
    externalLabel: 'Open the kiosk',
    externalDescription:
      'The kiosk terminal runs as a studio-managed background process on this machine.',
  },
  docs: {
    markdown:
      '# Public Service Kiosk\n\n' +
      'Embedded build of the Public Service Kiosk. The studio starts the kiosk server ' +
      'as a background worker (`workers/public-service-kiosk`) and the kiosk talks to the ' +
      'studio’s AI services on the local gateway.\n\n' +
      '- Kiosk UI: http://localhost:__KIOSK_PORT__\n' +
      '- Admin dashboard: http://localhost:__KIOSK_PORT__/admin\n' +
      '- Health: http://localhost:__KIOSK_PORT__/api/health\n\n' +
      'Touch-mode installs need only **text-generation** and **ocr**; chat/agent ' +
      'installs also use face-recognition and the speech services.',
  },
}
