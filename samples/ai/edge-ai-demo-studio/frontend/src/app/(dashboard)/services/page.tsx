// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ServicesContent, ServicesPageSkeleton } from './services-content'

export const metadata: Metadata = { title: 'Services' }

export default function ServicesPage() {
  // Search and filter read the address, which is only known in the browser.
  return (
    <Suspense fallback={<ServicesPageSkeleton />}>
      <ServicesContent />
    </Suspense>
  )
}
