// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from 'next'
import { Suspense } from 'react'
import { GallerySkeleton } from '@/components/samples/gallery-skeleton'
import { SamplesGallery } from '@/components/samples/samples-gallery'

export const metadata: Metadata = {
  title: 'Samples',
  description: 'Explore AI samples for your device.',
}

/** The gallery reads its filters via `useSearchParams`, which needs Suspense for prerendering. */
export default function SamplesPage() {
  return (
    <Suspense fallback={<GallerySkeleton />}>
      <SamplesGallery />
    </Suspense>
  )
}
