// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { notFound } from 'next/navigation'
import { SampleOSGuard } from '@/components/dashboard/samples/samples-os-guard'
import { samples } from '@/samples/registry'
import { SampleDemoContent } from '@/components/dashboard/samples/samples-demo-content'

export function generateStaticParams() {
  return samples.map((s) => ({ sampleId: s.id }))
}

export default async function SampleDemoPage({
  params,
}: {
  params: Promise<{ sampleId: string }>
}) {
  const { sampleId } = await params
  const sample = samples.find((s) => s.id === sampleId)

  if (!sample) {
    notFound()
  }

  return (
    <SampleOSGuard sample={sample}>
      <SampleDemoContent sampleId={sampleId} />
    </SampleOSGuard>
  )
}
