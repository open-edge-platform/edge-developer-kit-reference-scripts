// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { samples } from '@/samples/registry'
import { SampleOSGuard } from '@/components/dashboard/samples/samples-os-guard'
import { SampleDetailContent } from '@/components/dashboard/samples/samples-detail-context'

export function generateStaticParams() {
  return samples.map((s) => ({ sampleId: s.id }))
}

export default async function SampleDetailPage({
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
      <div className="page-enter space-y-6">
        <Link
          href="/samples"
          className="group text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Back to Samples
        </Link>
        <SampleDetailContent sampleId={sampleId} />
      </div>
    </SampleOSGuard>
  )
}
