// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useGetService } from '@/context/service-status-context'
import { SuiteLaunchPanel } from '@/samples/common/components/suite-launch-panel'
import { palletDefectDetectionSuite } from './config'

export function PalletDefectDetectionDemo() {
  const service = useGetService(palletDefectDetectionSuite.serviceId)
  // The suite's nginx reverse proxy maps the service's HTTP port to 80 and
  // HTTPS port (== port+1) to 443, so the user-facing launch URL is HTTPS on
  // port+1. Default WebRTC stream lives at /mediamtx/pdd/.
  const httpsPort = service?.port ? service.port + 1 : undefined
  const launchUrl = httpsPort
    ? `https://localhost:${httpsPort}/mediamtx/pdd/`
    : palletDefectDetectionSuite.launchUrl

  return (
    <SuiteLaunchPanel
      {...palletDefectDetectionSuite}
      launchUrl={launchUrl}
      popupHint="The page uses a self-signed TLS certificate — accept the browser warning to view the WebRTC stream."
    />
  )
}
