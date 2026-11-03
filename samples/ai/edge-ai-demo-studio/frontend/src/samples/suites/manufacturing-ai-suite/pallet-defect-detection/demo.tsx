// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useGetService } from '@/context/service-status-context'
import { SuiteLaunchPanel } from '@/samples/common/components/suite-launch-panel'
import { suiteHttpsUrl } from '@/services/suites/ports'
import { palletDefectDetectionSuite } from './config'

export function PalletDefectDetectionDemo() {
  const service = useGetService(palletDefectDetectionSuite.serviceId)
  // The suite serves its own page over HTTPS; the default WebRTC stream
  // lives at /mediamtx/pdd/.
  const launchUrl =
    suiteHttpsUrl(service, '/mediamtx/pdd/') ??
    palletDefectDetectionSuite.launchUrl

  return (
    <SuiteLaunchPanel
      {...palletDefectDetectionSuite}
      launchUrl={launchUrl}
      popupHint="The page uses a self-signed TLS certificate — accept the browser warning to view the WebRTC stream."
    />
  )
}
