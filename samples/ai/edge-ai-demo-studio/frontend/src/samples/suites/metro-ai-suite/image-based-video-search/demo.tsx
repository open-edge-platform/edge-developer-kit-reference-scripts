// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useGetService } from '@/context/service-status-context'
import { SuiteLaunchPanel } from '@/samples/common/components/suite-launch-panel'
import { imageBasedVideoSearchSuite } from './config'

export function ImageBasedVideoSearchDemo() {
  const service = useGetService(imageBasedVideoSearchSuite.serviceId)
  // The suite's nginx reverse proxy maps the service's HTTP port to 80 and
  // HTTPS port (== port+1) to 443, so the user-facing launch URL is HTTPS on
  // port+1. Fall back to the configured default when the service has not
  // been registered yet (e.g. during initial render).
  const httpsPort = service?.port ? service.port + 1 : undefined
  const launchUrl = httpsPort
    ? `https://localhost:${httpsPort}/`
    : imageBasedVideoSearchSuite.launchUrl

  return (
    <SuiteLaunchPanel {...imageBasedVideoSearchSuite} launchUrl={launchUrl} />
  )
}
