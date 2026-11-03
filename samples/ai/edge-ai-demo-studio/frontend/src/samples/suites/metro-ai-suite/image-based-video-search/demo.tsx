// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useGetService } from '@/context/service-status-context'
import { SuiteLaunchPanel } from '@/samples/common/components/suite-launch-panel'
import { suiteHttpsUrl } from '@/services/suites/ports'
import { imageBasedVideoSearchSuite } from './config'

export function ImageBasedVideoSearchDemo() {
  const service = useGetService(imageBasedVideoSearchSuite.serviceId)
  // The suite serves its own page over HTTPS; until the instance has a port
  // (e.g. during the first render) the configured default stands in.
  const launchUrl =
    suiteHttpsUrl(service) ?? imageBasedVideoSearchSuite.launchUrl

  return (
    <SuiteLaunchPanel {...imageBasedVideoSearchSuite} launchUrl={launchUrl} />
  )
}
